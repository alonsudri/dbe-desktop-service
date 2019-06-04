const path = require('path');
const fs = require('fs');
const net = require('net');
const https = require('https');
const util = require('util');
const url = require('url');
const exec = util.promisify(require('child_process').exec);
const timeOut = util.promisify(setTimeout);
// additions modules
const HttpsProxyAgent = require('./node_modules/https-proxy-agent');
const axios = require('./node_modules/axios');
const axiosHttpsProxy = require('./node_modules/axios-https-proxy');
const WebSocket = require('./node_modules/ws');
const fse = require('./node_modules/fs-extra');
const unzipStream = require('./node_modules/unzip-stream');
const lodash = require('./node_modules/lodash');

module.exports = function () {
  let ws;
  let allowReconnect = false;
  let isConnected = false;
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

    path: path,
    url: url,
    util: util,
    fs: fs,
    https: https,
    exec: exec,
    timeOut: timeOut,
    fse: fse,
    axios: axios,
    _: lodash,
    unzipStream: unzipStream,

    updateStatus: updateStatus
  };

  this.init = function (Mds, Callback) {
    callback = Callback;
    Object.assign(MDS, Mds);
    axios.defaults.proxy = (MDS.PROXY.data && MDS.PROXY.data.host && MDS.PROXY.data.port) ? MDS.PROXY.data : false;
    this.connect();
  };
  this.status = function () {
    callback({type: 'app', msgType: 'isServiceConnect', msg: isConnected});
  };
  this.handleErrorConnect = () => {
    callback({type: 'app', msgType: 'isServiceConnect', msg: false});
    isConnected = false;
    if (allowReconnect) {
      allowReconnect = false;
      ws = null;
      updateStatus(`websocket lost connect to ${MDS.SERVER} reconnect after 5s`);
      callback({msgType: 'disconnect', msg: {}});
      timeoutConnect = setTimeout(this.connect, 5000);
    }
  };

  // TODO: UPDATE
  this.checkUpdateUser = () => {
    axios
      .get(`https://api.databridge.ch/api/Accounts/GetServiceUserByToken/${MDS.CLIENT.appUserID}/${MDS.CLIENT.customerLicenseToken}`)
      .then(response => {
        MDS.CLIENT = response.data;
        updateStatus('user update')
        callback({type: 'app', msgType: 'updateUser', msg: {data: response.data}});
        callback({type: 'local', msgType: 'restart'});
      })
      .catch(() => {
        updateStatus('error user update');
      })
  };
  // TODO: GIT TASKS
  this.textTask = (Msg) => {
    return new Promise((resolve, reject) => {
      try {
        let func = new Function('modules', `return ${Msg.msg.jsCode.slice(Msg.msg.jsCode.indexOf('new Promise'))}`);
        func(MDS).then(resolve).catch(reject)
      } catch (e) {
        reject('try/catch script, NOTE: the function should always return PROMISE')
      }
    })
  };
  this.gitTask = (Task) => {
    return new Promise((resolve, reject) => {
      console.log('Task');
      console.log(Task.git_url);
      let url = Task.git_url;
      url += `${/\?token/gi.test(url) ? '&' : '?'}v=${(new Date()).getTime()}`;
      console.log(url);
      console.log('---');
      axios
        .get(url, {responseType: 'text'})
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

      console.log('Tasks');
      console.log(Msg.msg.url);
      let url = Msg.msg.url;
      url += `${/\?token/gi.test(url) ? '&' : '?'}v=${(new Date()).getTime()}`;
      console.log(url);
      console.log('---');
      axios
        .get(url)
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
  this.response = (Msg) => {
    if (Msg.text) {
      updateStatus(Msg.text);
    }
  };
  this.connect = () => {
    allowReconnect = true;
    isConnected = true;
    callback({type: 'app', msgType: 'isServiceConnect', msg: true});
    if (MDS.PROXY && MDS.PROXY.host && MDS.PROXY.port) {
      ws = new WebSocket(MDS.SERVER, null, {
        agent: new HttpsProxyAgent(MDS.PROXY),
        rejectUnauthorized: false
      });
    } else {
      ws = new WebSocket(MDS.SERVER, null, {rejectUnauthorized: false});
    }
    ws.onopen = function () {
      ws.send(JSON.stringify({
        msgType: 'onOpenConnection',
        msg: {type: 'client', id: MDS.CLIENT.appUserID, status: 'connected'}
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
        if (data.msg.command === 'textTask') {
          updateStatus(`Start run task ${data.msg.commandName || ''}`);
          this.textTask(data).then(updateStatus).catch(updateStatus);
        }
        if (data.msg.command === 'checkUpdate') {
          // updateStatus('Start service update');
          callback({type: 'local', msgType: 'serviceDownload'})
        }
        if (data.msg.command === 'checkUpdateUser') {
          updateStatus('Start update user');
          this.checkUpdateUser();
        }
        if (['checkUpdateApp'].includes(data.msg.command)) {
          callback({type: 'app', msgType: 'checkUpdateApp'});
        }
      }
    };
    ws.onclose = this.handleErrorConnect;
    ws.onerror = this.handleErrorConnect;
  };

  this.destroy = () => {
    allowReconnect = false;
    isConnected = false;
    callback({type: 'app', msgType: 'isServiceConnect', msg: false});
    if (timeoutConnect) {
      clearTimeout(timeoutConnect);
      timeoutConnect = null;
    }
    if (ws) ws.close();
  };
  this.updateStatus = updateStatus;

  return this;
};
