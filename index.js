module.exports = function () {
  const HttpsProxyAgent = require('./node_modules/https-proxy-agent');

  let ws;
  let allowReconnect = false;
  let timeoutConnect;
  let callback;

  const updateStatus = (Msg) => {
    let msg = {msgType: 'onUpdateStatus', msg: Msg};
    callback(msg);
    if (ws) ws.send(JSON.stringify(msg));
  };

  const MDS = {
    // constants
    CLIENT: null,
    SERVER: 'wss://db-engine-service.azurewebsites.net:443',
    VERSION: require('./package').version,
    DIR_HOME: null,
    DIR_APP: null,

    updateStatus: updateStatus
  };

  this.init = function (Mds, Callback) {
    callback = Callback;
    Object.assign(MDS, Mds);
    this.connect();
  };
  this.handleErrorConnect = () => {
    if (allowReconnect) {
      allowReconnect = false;
      ws = null;
      updateStatus(`websocket lost connect to ${MDS.SERVER} reconnect after 5s`);
      callback({msgType: 'disconnect', msg: {}});
      timeoutConnect = setTimeout(this.connect, 5000);
    }
  };

  // TODO: UPDATE
  this.checkUpdate = () => {
    return new Promise((resolve, reject) => {
      MDS.axios
        .get('https://api.github.com/repos/czalexpic/dbe-desktop-service/tags')
        .then(response => {
          let latest = response.data[0];
          if (latest) {
            if (latest.name === MDS.VERSION) {
              reject('Service no need update');
            } else {
              resolve('Download service new version');
              callback({msgType: 'updateTo', msg: {version: latest.name}});
            }
          } else {
            reject('Error update - error load release list');
          }
        })
    })

  };
  this.checkUpdateUser = () => {
    return new Promise((resolve, reject) => {
      MDS.axios
        .get(`https://api.databridge.ch/api/Accounts/GetServiceUserByToken/${MDS.CLIENT.appUserID}/${MDS.CLIENT.customerLicenseToken}`)
        .then(response => {
          MDS.CLIENT = response.data;
          callback({msgType: 'updateUser', msg: {data: response.data}});
          resolve('user update')
        })
        .catch(() => {
          reject('error user update');
        })
    });
  };
  // TODO: GIT TASKS
  this.gitTask = (Task) => {
    return new Promise((resolve, reject) => {
      MDS.axios
        .get(Task.git_url, {responseType: 'text'})
        .then(response => {
          try {
            let script = response.data;
            let func = new Function('parameters, modules', `return ${script.slice(script.indexOf('new Promise'))}`);
            func(Task.parameters, MDS)
              .then(resolve)
              .catch(reject)
          } catch (e) {
            reject('try/catch script, NOTE: the function should always return PROMISE')
          }
        })
        .catch(_ => {
          reject('error load script')
        })
    })
  };
  this.gitTasks = (Msg) => {
    return new Promise((resolve, reject) => {
      async function asyncTasks(Tasks, self) {
        for (let i = 0; i < Tasks.length; i++) await self.gitTask(Tasks[i], Msg);
        return `Task ${Msg.msg.commandName || ''} Done`;
      }

      MDS.axios
        .get(Msg.msg.url)
        // .get('https://raw.githubusercontent.com/czalexpic/test-tasks/master/tasks.json')
        .then(response => {
          asyncTasks(response.data, this)
            .then(resolve)
            .catch(reject)
        })
        .catch(() => {
          reject(`Error load task ${Msg.msg.commandName || ''}`)
        })
    })
  };

  this.connect = () => {
    allowReconnect = true;
    if (MDS.CLIENT.proxyURL) {
      ws = new MDS.WebSocket(MDS.SERVER, null, {
        agent: new HttpsProxyAgent(MDS.url.parse(MDS.CLIENT.proxyURL)),
        rejectUnauthorized: false
      });
    } else {
      ws = new MDS.WebSocket(MDS.SERVER, null, {rejectUnauthorized: false});
    }
    ws.onopen = function () {
      ws.send(JSON.stringify({
        msgType: 'onOpenConnection',
        msg: {type: 'client', id: MDS.CLIENT.appUserID, status: 'connected', client: MDS.CLIENT}
      }));
      callback({msgType: 'connect', msg: {}});
    };
    ws.onmessage = (ev) => {
      let data = JSON.parse(ev.data);
      if (data.msgType === 'onSendCommand') {
        if (data.msg.command === 'gitTasks') {
          updateStatus(`Start run task ${data.msg.commandName || ''}`);
          this.gitTasks(data).then(updateStatus).catch(updateStatus);
        }
        if (data.msg.command === 'checkUpdate') {
          updateStatus('Start service update');
          this.checkUpdate().then(updateStatus).catch(updateStatus);
        }
        if (data.msg.command === 'checkUpdateUser') {
          updateStatus('Start update user');
          this.checkUpdateUser().then(updateStatus).catch(updateStatus);
        }
        if (data.msg.command === 'checkUpdateApp') {
          callback(data)
        }
      }
    };
    ws.onclose = this.handleErrorConnect;
    ws.onerror = this.handleErrorConnect;
  };

  this.destroy = () => {
    allowReconnect = false;
    if (timeoutConnect) {
      clearTimeout(timeoutConnect);
      timeoutConnect = null;
    }
    if (ws) ws.close();
  };

  return this;
};
