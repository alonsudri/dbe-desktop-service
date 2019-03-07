#!/usr/bin/env node
const path = require('path');
const url = require('url');
const util = require('util');

const HttpsProxyAgent = require('https-proxy-agent');
const WebSocket = require('ws');
const axios = require('axios');
const _ = require('lodash');

axios.interceptors.request.use(function (config) {
  if (config.method === 'get') config.url += `?v${_.random(0, 100000)}${(new Date()).getTime()}`
  console.log(config.url)
  return config
}, function (error) {
  return Promise.reject(error)
});

const SERVER = `wss://${process.env.SERVER || 'db-engine-service.azurewebsites.net'}:443`;
const CLIENT = 'TEST';//process.env.CLIENT || `${Math.random()}${(new Date()).getTime()}`.replace(/\./g, '');
const PROXY = process.env.PROXY;
const AGENT = (PROXY) ? new HttpsProxyAgent(url.parse(PROXY)) : null;
const updater = require('./updater');

let TIMEOUT;
let ws;
let allowReconnect = false;

const updateStatus = function (Msg) {
  if (ws) ws.send(JSON.stringify({msgType: 'onUpdateStatus', msg: Msg}))
}

const hardReset = () => {
  if (TIMEOUT) {
    clearTimeout(TIMEOUT);
    TIMEOUT = null;
  }
  throw new Error('HARD RESTART SERVICE -> APPLY UPDATE');
};

// :TODO MDS = MODULES
const MDS = {
  // constants
  SERVER: SERVER,
  VERSION: require('./package').version,
  DIR_HOME: process.env.DIR_HOME,
  DIR_APP: process.env.DIR_APP,

  path: path,
  url: url,
  util: util,
  fs: require('fs'),
  fse: require('fs-extra'),
  https: require('https'),
  unzipStream: require('unzip-stream'),
  exec: util.promisify(require('child_process').exec),
  timeOut: util.promisify(setTimeout),
  axios: axios,
  _: _,
  updateStatus: updateStatus,
  hardReset: hardReset
};

function ErrorConnected(e) {
  if (allowReconnect) {
    allowReconnect = false
    console.log('websocket lost connect to', SERVER, 'reconnect after 5s')
    ws = null
    setTimeout(Connect, 5000)
  }
}

function Connect() {
  if (TIMEOUT === null) {
    TIMEOUT = setInterval(_ => {
      console.log('ping not stop service');
    }, 86400000);
  }
  allowReconnect = true
  console.log('websocket start connected to', SERVER)
  if (AGENT) {
    ws = new WebSocket(SERVER, {agent: AGENT, rejectUnauthorized: false})
  } else {
    ws = new WebSocket(SERVER, {rejectUnauthorized: false})
  }
  ws.onopen = function () {
    console.log('websocket is connected ...')
    ws.send(JSON.stringify({
      msgType: 'onOpenConnection',
      msg: {type: 'client', id: CLIENT, status: 'connected'}
    }))
    // TODO: remove prev versions
    updater.checkRemovePreviousVersion(MDS)
  }
  ws.onmessage = (ev) => {
    let data = JSON.parse(ev.data)
    if (data.msgType === 'onSendCommand') {
      if (data.msg.command === 'gitTasks') new gitTasks(data)
      if (data.msg.command === 'checkUpdate') updater.checkVersion(MDS)
      if (data.msg.command === 'restart') hardReset();
    }
  };
  ws.onclose = ErrorConnected
  ws.onerror = ErrorConnected
}

const TASK = function (Task) {
  return new Promise((resolve, reject) => {
    axios
      .get(Task.git_url, {responseType: 'text'})
      .then(response => {
        try {
          let script = response.data
          let func = new Function('parameters, modules', `return ${script.slice(script.indexOf('new Promise'))}`)
          func(Task.parameters, MOD)
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
}

function gitTasks(Msg) {
  async function asyncTasks(Tasks) {
    for (let i = 0; i < Tasks.length; i++) {
      await new TASK(Tasks[i], Msg)
    }
    return 'all Done'
  }

  axios
  // .get(Msg.msg.url)
    .get('https://raw.githubusercontent.com/czalexpic/test-tasks/master/tasks.json')
    .then(response => {
      asyncTasks(response.data)
        .then(response => {
          console.log(response)
        })
        .catch(response => {
          console.log(response)
        })
    })
    .catch(e => {
      console.log('error load tasks')
      console.log(e)
    })
}

Connect()

