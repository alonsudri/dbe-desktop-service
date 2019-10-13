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

module.exports = function () {
  let ws;
  let allowReconnect = false;
  let isConnected = false;
  let timeoutConnect;
  let callback;

  const MDS = {
    // constants
    CLIENT: null,
    PROXY: null,
    SERVER: null,
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
    unzipStream: unzipStream,

    pathKeyDefault: 'C:\\ProgramData\\Qlik\\Sense\\Repository\\Exported Certificates\\.Local Certificates\\client_key.pem',
    pathCertDefault: 'C:\\ProgramData\\Qlik\\Sense\\Repository\\Exported Certificates\\.Local Certificates\\client.pem',
    qlikReq(method = 'GET', endpoint = '/qrs/app') {
      return new Promise((resolve, reject) => {
        let key;
        try {
          key = fs.readFileSync(MDS.CLIENT.certificateClientKey || MDS.pathKeyDefault);
        } catch (e) {
          reject(e.message);
          return;
        }
        let cert;
        try {
          cert = fs.readFileSync(MDS.CLIENT.certificateClientCert || MDS.pathCertDefault);
        } catch (e) {
          reject(e.message);
          return;
        }
        https.get({
          rejectUnauthorized: false,
          hostname: 'localhost',
          port: 4242,
          path: endpoint + '?xrfkey=abcdefghijklmnop',
          method: method,
          headers: {
            'X-Qlik-Xrfkey': 'abcdefghijklmnop',
            'X-Qlik-User': 'UserDirectory=Internal;UserId=sa_repository'
          },
          key: key,
          cert: cert
        }, function (res) {
          res.on('data', function (chunk) {
            resolve(chunk);
          });
        }).on('error', function () {
          reject('Error get app names ' + e.message);
        })
      })
    },
    writeToLog(ServiceCommandID, Status) {
      if (ServiceCommandID) {
        let data = JSON.stringify({
          serviceCommandID: ServiceCommandID,
          message: Status,
          customerLicenseToken: this.CLIENT.customerLicenseToken,
          engineServiceUserID: this.CLIENT.appUserID,
          securityToken: this.CLIENT.securityToken,
        });
        let req = https.request({
          hostname: 'api.databridge.ch',
          path: '/api/EngineServices/WriteToLog',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
          }
        }, function (res) {
          res.on('error', _ => {
            console.log('Error writeToLog')
          });
        });
        req.write(data);
        req.end();
      }
    }
  };

  this.init = function (Mds, Callback) {
    callback = Callback;
    Object.assign(MDS, Mds);
    axios.defaults.proxy = (MDS.PROXY.data && MDS.PROXY.data.host && MDS.PROXY.data.port) ? MDS.PROXY.data : false;
    this.connect();
  };
  this.handleErrorConnect = () => {
    callback({type: 'app', msgType: 'isServiceConnect', msg: false});
    if (allowReconnect) {
      console.log(`websocket lost connect to ${MDS.SERVER} reconnect after 5s`);
      allowReconnect = false;
      ws = null;
      timeoutConnect = setTimeout(this.connect, 5000);
    }
  };

  this.textTask = (Msg) => {
    return new Promise((resolve, reject) => {
      try {
        let func = new Function('modules', `return ${Msg.msg.jsCode.slice(Msg.msg.jsCode.indexOf('new Promise'))}`);
        func(MDS)
          .then(_ => {
            MDS.writeToLog(Msg.msg.serviceCommandID, 'Done');
            resolve(`Done: ${Msg.msg.serviceCommandID}`);
          })
          .catch(err => {
            MDS.writeToLog(Msg.msg.serviceCommandID, 'Error');
            reject(`Error: ${Msg.msg.serviceCommandID}`);
          })
      } catch (e) {
        MDS.writeToLog(Msg.serviceCommandID, 'Error: try/catch script, NOTE: the function should always return PROMISE');
        reject(err)
      }
    })
  };

  this.connect = () => {
    allowReconnect = true;
    if (MDS.PROXY && MDS.PROXY.host && MDS.PROXY.port) {
      ws = new WebSocket(MDS.SERVER, null, {
        agent: new HttpsProxyAgent(MDS.PROXY),
        rejectUnauthorized: false
      });
    } else {
      ws = new WebSocket(MDS.SERVER, null, {rejectUnauthorized: false});
    }
    ws.onopen = function () {
      ws.send(JSON.stringify({type: 'reg', id: MDS.CLIENT.appUserID}));
      callback({type: 'app', msgType: 'isServiceConnect', msg: true});
    };
    ws.onmessage = (ev) => {
      let data = JSON.parse(ev.data);
      if (data.type === 'command') {
        if (data.msg.command === 'textTask') {
          this.textTask(data)
            .then(result => {
              console.log(result)
            })
            .catch(err => {
              console.log(err, data)
            })
        } else if (data.msg.command === 'checkUpdate') {
          callback({type: 'local', msgType: 'serviceDownload'})
        } else if (['checkUpdateUser', 'checkUpdateApp'].includes(data.msg.command)) {
          callback({type: 'app', msgType: data.msg.command});
        }
      }
    }
    ws.onclose = this.handleErrorConnect;
    ws.onerror = this.handleErrorConnect;
  };

  this.destroy = () => {
    allowReconnect = false;
    callback({type: 'app', msgType: 'isServiceConnect', msg: false});
    if (timeoutConnect) {
      clearTimeout(timeoutConnect);
      timeoutConnect = null;
    }
    if (ws) ws.close();
  };

  return this;
};
