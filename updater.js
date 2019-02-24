module.exports.checkVersion = function (MDS) {
  let check = (MDS) => {
    MDS.axios
      .get('https://api.github.com/repos/czalexpic/dbe-desktop-service/tags')
      .then(response => {
        let latest = response.data[0]
        if (latest) {
          if (latest.name === MDS.VERSION) {
            MDS.updateStatus('Update no need')
          } else {
            MDS.updateStatus('Start download new version')
            downloadRelease(latest.name, MDS)
          }
        } else {
          MDS.timeOut(5000).then(_ => {
            check(MDS)
          })
        }
      })
  }
  let downloadRelease = (Version, MDS) => {
    MDS.https
      .get(`https://codeload.github.com/czalexpic/dbe-desktop-service/zip/${Version}`, (response) => {
        response
          .on('error', _ => {
            MDS.updateStatus('Error download new version, try again after 5s')
            MDS.timeOut(5000).then(_ => {
              downloadRelease(Version, MDS)
            })
          })
          .pipe(MDS.unzipStream.Extract({ path: MDS.DIR_APP }))
          .on('finish', _ => {
            MDS.timeOut(10000).then(_ => {
              MDS.updateStatus('Update service XML')
              updateXML(Version, MDS)
            })
          })
      })
  }
  let updateXML = (Version, MDS) => {
    MDS.fse.outputFile(MDS.path.join(MDS.DIR_APP, 'daemon', 'databridgeengineservice.xml'), `
      <service>
        <id>databridgeengineservice.exe</id>
        <name>Data Bridge Engine Service</name>
        <description>Data Bridge Engine Service</description>
        <executable>${MDS.path.join(MDS.DIR_APP, `dbe-desktop-service-${Version}`, 'node.exe')}</executable>
        <logmode>rotate</logmode>
        <argument>--harmony</argument>
        <argument>${MDS.path.join(MDS.DIR_APP, '..', 'resources', 'lib', 'wrapper.js')}</argument>
        <argument>--file</argument>
        <argument>${MDS.path.join(MDS.DIR_APP, `dbe-desktop-service-${Version}`, 'index.js')}</argument>
          <argument>--log</argument>
          <argument>Data Bridge Engine Service wrapper</argument>
          <argument>--grow</argument>
          <argument>0.25</argument>
          <argument>--wait</argument>
          <argument>1</argument>
          <argument>--maxrestarts</argument>
          <argument>3</argument>
          <argument>--abortonerror</argument>
          <argument>n</argument>
          <argument>--stopparentfirst</argument>
          <argument>undefined</argument>
          <stoptimeout>30sec</stoptimeout>
          <env name="HOME" value="${MDS.DIR_HOME}"/>
          <env name="APP" value="${MDS.DIR_APP}"/>
          <workingdirectory>${MDS.DIR_APP}</workingdirectory>
        </service>`)
      .then(_ => {
        MDS.updateStatus('Restart service')
        restartService(MDS)
      })
      .catch(_ => {
        MDS.updateStatus('Error download new version, try again after 5s')
        MDS.timeOut(5000).then(_ => {
          updateXML(Version, MDS)
        })
      })
  }
  let restartService = (MDS) => {
    try {
      MDS.exec('net stop databridgeengineservice.exe && net start databridgeengineservice.exe')
        .then(_ => {
          MDS.updateStatus('Update finish')
        })
        .catch(_ => {
          MDS.updateStatus('Error restart service, try again after 5s')
          MDS.timeOut(5000).then(_ => {
            restartService(MDS)
          })
        })
    } catch (e) {
      MDS.updateStatus('Error restart service, try again after 5s')
      MDS.timeOut(5000).then(_ => {
        restartService(MDS)
      })
    }
  }
  check(MDS)
}
module.exports.checkRemovePreviousVersion = function (MDS) {
  MDS.fse.readJson(MDS.path.join(MDS.DIR_APP, 'config.json'))
    .then(response => {
      if (MDS.VERSION !== response.isServiceVersion) {
        MDS.fse.remove(MDS.path.join(MDS.DIR_APP, `dbe-desktop-service-${response.isServiceVersion}`))
          .then(_ => {
            MDS.fse.writeJson(MDS.path.join(MDS.DIR_APP, 'config.json'), Object.assign(response, { isServiceVersion: MDS.VERSION }))
              .catch(_ => {
                MDS.updateStatus('Error update config.json')
              })
          })
          .catch(_ => {
            MDS.updateStatus('Error remove previous version')
          })
      }
    })
    .catch(_ => {
      MDS.updateStatus('Error load config.json')
    })
}
