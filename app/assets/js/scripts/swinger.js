/**
 * Paladium Launcher - https://github.com/Paladium-Dev/Paladium-Launcher
 * Copyright (C) 2020 Paladium
 */

const $ = require('jquery');
const {ipcRenderer, remote, shell, webFrame} = require('electron');
const request = require('request');
const cp = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const system = require("systeminformation");

const isDev = require('./assets/js/isdev');
const LoggerUtil = require('./assets/js/logger_util');
const { Library, JavaManager } = require('./assets/js/job_manager');
const ConfigManager = require('./assets/js/config_manager');
const DistroManager = require('./assets/js/distro_manager');
const AuthManager = require('./assets/js/auth_manager');

const loggerLauncher = LoggerUtil('launcher');

const launcherVersion = "0.0.01-d18";
let system_gpu;

// Log deprecation and process warnings.
process.traceProcessWarnings = true;
process.traceDeprecation = true;

// Disable eval function.
// eslint-disable-next-line
window.eval = global.eval = function () {
    throw new Error('Sorry, this app does not support window.eval().');
};

// Disable zoom, needed for darwin.
webFrame.setZoomLevel(0);
webFrame.setVisualZoomLevelLimits(1, 1);
webFrame.setLayoutZoomLevelLimits(0, 0);

document.addEventListener('readystatechange', function() {
    if (document.readyState === 'complete') {
        const configOldPath = path.join(ConfigManager.getWorkingDirectory(), 'config.json');

        if (!fs.existsSync(configOldPath)) {
            initLauncher();
            return;
        }
        setLoadingStatut("Suppression du \".paladium\"..");
        if (dirDelete(ConfigManager.getWorkingDirectory()) === 0) {
            initLauncher();
        }
    }
}, false);

function initLauncher() {
    setLoadingStatut("Connexion en cours");

    system.graphics((data) => {
        system_gpu = data.controllers[0];
        loggerLauncher.log("OS: " + Library.mojangFriendlyOS());
        loggerLauncher.log("GPU: " + system_gpu.model);

        DistroManager.pullRemote("http://212.83.174.53/launcher/distribution.json").then((data) => {
            loggerLauncher.log("Loaded distribution index");
            onDistroLoad(data);
        }).catch((err) => {
            loggerLauncher.error("Failed to load distribution index!");
            console.error("Failed to load distribution index!");
            console.error(err);

            setOverlayContent("Impossible de se connecter au serveur !",
                "Merci de vérifier votre connexion à internet ou votre proxy si vous en utilisez un.",
                "Fermer le launcher", null, 15, "Tentative de reconnexion dans");
            toggleOverlay(true);
            setCloseHandler(() => closeLauncher());
            setTimeout(function() {
                toggleOverlay(false);
                initLauncher();
            }, 15000);
        });
    });
}

function dirDelete(fPath) {
    try {
        if (fs.existsSync(fPath)) {
            fs.readdirSync(fPath).forEach((file, index) => {
                const curPath = path.join(fPath, file);
                if (fs.lstatSync(curPath).isDirectory()) {
                    dirDelete(curPath);
                }
                else {
                    fs.unlinkSync(curPath);
                }
            });
            fs.rmdirSync(fPath);
        }
        else {
            return 1;
        }
        return 0
    }
    catch (exception) {
        console.error(exception);
        return 2;
    }
}

function parseLauncherVersion(verString) {
    const ret = {};
    let pts = verString.split('-');
    ret.build = parseInt(pts[1].substring(1));
    pts = pts[0].split('.');
    ret.update = parseInt(pts[2]);
    ret.minor = parseInt(pts[1]);
    ret.major = parseInt(pts[0]);
    return ret;
}

function onDistroLoad(data) {
    if (data != null) {
        if (ConfigManager.getSelectedInstance() == null || data.getInstance(ConfigManager.getSelectedInstance()) == null) {
            loggerLauncher.log('Determining default selected instance..');
            if (data.getMainInstance() != null) {
                ConfigManager.setSelectedInstance(data.getMainInstance().getID());
                ConfigManager.save();
            }
        }
    }

    if (data.getMaintenance().enabled) {
        setOverlayContent('Maintenance du launcher !',
            data.getMaintenance().message,
            'Fermer le launcher', null, 30, 'Tentative de reconnexion dans');
        toggleOverlay(true);

        setCloseHandler(() => {
            closeLauncher();
        });

        setTimeout(function() {
            toggleOverlay(false);
            initLauncher();
        }, 30000);
        return;
    }

    if (data.getMainInstance() == null) {
        return;
    }

    let forceUpdate = false;
    var versionMin = parseLauncherVersion(data.getVersionMinimum());
    var version = parseLauncherVersion(launcherVersion);
    if ((version.build < versionMin.build) || (version.update < versionMin.update) || (version.minor < versionMin.minor) || (version.major < versionMin.major)) {
        forceUpdate = true;
    }

    ipcRenderer.on('autoUpdateNotification', (event, arg, info) => {
        const loggerAutoUpdater = LoggerUtil('auto-update');
        switch(arg) {
            case 'checking-for-update': {
                loggerAutoUpdater.log('Checking for update..');
                setLoadingStatut('Recherche de mise à jour');
                break;
            }
            case 'update-available': {
                loggerAutoUpdater.log('New update available:', info.version);

                if (!forceUpdate && process.platform == 'win32') {
                    setOverlayContent('Mise à jour du launcher disponible !',
                        'Une nouvelle mise à jour pour le launcher est disponible.'
                        + '<br>Voulez-vous l\'installer maintenant ?',
                        'Plus tard', 'Télécharger');
                    toggleOverlay(true);
                    setCloseHandler(() => {
                        toggleOverlay(false);
                        onAutoUpdateFinish();
                    });
                    setActionHandler(() => {
                        toggleOverlay(false);
                        setLoadingStatut('Préparation de la mise à jour (peut prendre un moment)');
                        ipcRenderer.send('autoUpdateAction', 'downloadUpdate');
                    });
                }
                else {
                    if (process.platform == 'win32') { // Temp
                        setOverlayContent('Mise à jour du launcher disponible !',
                            'Une nouvelle mise à jour pour le launcher est disponible.'
                            + '<br>Voulez-vous l\'installer maintenant ?'
                            + '<br><br><i class="fas fa-chevron-right"></i> Cette mise à niveau est obligatoire pour pouvoir continuer.',
                            'Fermer le launcher', 'Télécharger');
                        toggleOverlay(true);
                        setCloseHandler(() => {
                            toggleOverlay(false);
                            closeLauncher();
                        });
                        setActionHandler(() => {
                            toggleOverlay(false);
                            setLoadingStatut('Préparation de la mise à jour (peut prendre un moment)');
                            ipcRenderer.send('autoUpdateAction', 'downloadUpdate');
                        });
                    }
                    else {
                        setOverlayContent('Mise à jour du launcher disponible !',
                            'Une nouvelle mise à jour pour le launcher est disponible.'
                            + '<br>Vous pouvez la télécharger sur le site officiel de Paladium.'
                            + '<br><br><i class="fas fa-chevron-right"></i> Cette mise à niveau est obligatoire pour pouvoir continuer.',
                            'Fermer le launcher');
                        toggleOverlay(true);
                        setCloseHandler(() => {
                            toggleOverlay(false);
                            closeLauncher();
                        });
                    }
                }
                break;
            }
            case 'update-not-available': {
                if ((version.build < versionMin.build) || (version.update < versionMin.update) || (version.minor < versionMin.minor) || (version.major < versionMin.major)) {
                    setOverlayContent('Launcher obselète !',
                            'Votre launcher est obselète !'
                            + '<br><br><i class="fas fa-chevron-right"></i> Merci de retélécharger le launcher sur le site officiel de Paladium.',
                            'Fermer le launcher');
                        toggleOverlay(true);
                        setCloseHandler(() => {
                            closeLauncher();
                        });
                    return;
                }
                else
                    onAutoUpdateFinish();
                break;
            }
            case 'download-progress': {
                setLoadingStatut('Mise à jour en cours (' + Math.round(info.percent) + "%)");
                break;
            }
            case 'update-downloaded': {
                loggerAutoUpdater.log('Update ' + info.version + ' ready to be installed.');

                setOverlayContent('La mise à jour est prêt à être installé !',
                    'Cliquer sur installer pour lancer l\'installation de ma mise à jour du launcher.',
                    'Plus tard (Ferme le launcher)', 'Installer');
                toggleOverlay(true);
                setCloseHandler(() => {
                    closeLauncher();
                });
                setActionHandler(() => {
                    toggleOverlay(false);
                    ipcRenderer.send('autoUpdateAction', 'installUpdateNow');
                });
                break;
            }
            case 'ready': {
                ipcRenderer.send('autoUpdateAction', 'checkForUpdate');
                break;
            }
            case 'realerror': {
                if (info != null && info.code != null) {
                    if (info.code === 'ERR_UPDATER_INVALID_RELEASE_FEED')
                        loggerAutoUpdater.log('No suitable releases found.');
                    else if (info.code === 'ERR_XML_MISSED_ELEMENT')
                        loggerAutoUpdater.log('No releases found.');
                    else {
                        loggerAutoUpdater.error('Error during update check..', info);
                        loggerAutoUpdater.debug('Error Code:', info.code);
                    }

                    setOverlayContent('Impossible de se connecter au serveur !',
                        'Merci de vérifier votre connexion à internet ou votre proxy si vous en utilisez un.',
                        'Fermer le launcher', 'Réessayer');
                    toggleOverlay(true);
                    setCloseHandler(() => {
                        closeLauncher();
                    });
                    setActionHandler(() => {
                        toggleOverlay(false);
                        ipcRenderer.send('autoUpdateAction', 'initAutoUpdater');
                    });
                }
                break;
            }
            default: {
                loggerAutoUpdater.log('Unknown argument', arg);
                break;
            }
        }
    });

    if (!isDev) {
        ipcRenderer.send('autoUpdateAction', 'initAutoUpdater');
    }
    else {
        onAutoUpdateFinish();
    }
}

function onAutoUpdateFinish() {
    setLoadingStatut("Vérification de l'environnement Java");

    const jExe = ConfigManager.getJavaExecutable();
    if (jExe == null) {
        downloadJava();
    }
    else {
        const jg = new JavaManager();
        jg._validateJavaBinary(jExe).then((v) => {
            if (v.valid) {
                onValidateJava();
            }
            else {
                downloadJava();
            }
        });
    }
}

let extractListener;

function downloadJava() {
    const loggerSysAEx = LoggerUtil('java');

    const forkEnv = JSON.parse(JSON.stringify(process.env));
    forkEnv.CONFIG_DIRECT_PATH = ConfigManager.getLauncherDirectory();

    sysAEx = cp.fork(path.join(__dirname, 'assets', 'js', 'job_manager_exec.js'), [
        'JavaManager'
    ], {
        env: forkEnv,
        stdio: 'pipe'
    });

    // Stdout
    sysAEx.stdio[1].setEncoding('utf8');
    sysAEx.stdio[1].on('data', (data) => {
        loggerSysAEx.log(data);
    });
    // Stderr
    sysAEx.stdio[2].setEncoding('utf8');
    sysAEx.stdio[2].on('data', (data) => {
        loggerSysAEx.log(data);
    });

    sysAEx.on('message', (m) => {
        if (m.context === 'validateJava') {
            if (m.result == null || (system_gpu.model.includes("HD Graphics") && process.platform == 'win32')) {
                setLoadingStatut("Téléchargement de Java en cours");
                sysAEx.send({task: 'changeContext', class: 'JobManager', args: [ConfigManager.getCommonDirectory(), ConfigManager.getJavaExecutable()]});
                sysAEx.send({task: 'execute', function: '_downloadJava', argsArr: [ConfigManager.getWorkingDirectory()]});
            }
            else {
                ConfigManager.setJavaExecutable(m.result);
                ConfigManager.save();
                sysAEx.disconnect();
                onValidateJava();
            }
        }
        else if (m.context === '_downloadJava') {
            if (m.result === true) {
                sysAEx.send({task: 'execute', function: 'processDlQueues', argsArr: [[{id:'java', limit:1}]]});
            }
            else {
                setOverlayContent('Le téléchargement à échoué !',
                'Une erreur c\'est produite lors du téléchargement de Java.'
                + '<br>Nous vous conseillons de réessayer avec le bouton ci-dessous.',
                'Fermer le launcher', 'Réessayer');
                toggleOverlay(true);

                setCloseHandler(() => {
                    sysAEx.disconnect();
                    closeLauncher();
                });
                setActionHandler(() => {
                    toggleOverlay(false);
                    javaAssetEx.send({task: 'execute', function: 'processDlQueues', argsArr: [[{id:'java', limit:1}]]});
                });
            }
        }
        else if (m.context === 'progress') {
            switch (m.data) {
                case 'download': {
                    setLoadingStatut("Téléchargement de Java en cours (" + m.percent + "%)");
                    break
                }
            }
        }
        else if (m.context === 'complete') {
            switch (m.data) {
                case 'download': {
                    const eLStr = 'Installation';
                    let dotStr = '';
                    setLoadingStatut(eLStr);
                    extractListener = setInterval(() => {
                        if (dotStr.length >= 3) {
                            dotStr = '';
                        }
                        else {
                            dotStr += '.';
                        }
                        setLoadingStatut(eLStr + dotStr);
                    }, 750);
                    break;
                }
                case 'java': {
                    ConfigManager.setJavaExecutable(m.args[0]);
                    ConfigManager.save();

                    if (extractListener != null) {
                        clearInterval(extractListener);
                        extractListener = null;
                    }
                    sysAEx.disconnect();

                    onValidateJava();
                    break;
                }
            }
        }
        else if (m.context === 'error') {
            console.log(m.error);
        }
    });

    setLoadingStatut("Vérification des informations système");
    sysAEx.send({task: 'execute', function: 'validateJava', argsArr: [ConfigManager.getWorkingDirectory()]})
}

function onValidateJava() {
    setLoadingStatut("Chargement en cours");
    hideLoading();

    const isLoggedIn = Object.keys(ConfigManager.getAuthAccounts()).length > 0;
    const isLoggedInGood = ConfigManager.getSelectedAccount();
    if (isLoggedIn && isLoggedInGood != undefined) {
        if (validateSelectedAccount()) {
            showMainUI(VIEWS.launcher);
            initLauncherView();
        }
        else {
            showMainUI(VIEWS.login);
        }
    }
    else {
        showMainUI(VIEWS.login);
    }
}

async function validateSelectedAccount() {
    const selectedAcc = ConfigManager.getSelectedAccount();
    if (selectedAcc != null) {
        const val = await AuthManager.validateSelected();
        if (!val){
            ConfigManager.removeAuthAccount(selectedAcc.uuid);
            ConfigManager.save();
            return false;
        }
        else {
            return true;
        }
    }
    else {
        return true;
    }
}

async function validateSelectedAccount() {
    const selectedAcc = ConfigManager.getSelectedAccount();
    if (selectedAcc != null) {
        const val = await AuthManager.validateSelected();
        if (!val) {
            ConfigManager.removeAuthAccount(selectedAcc.uuid);
            ConfigManager.save();
        }
    }
}

/**
 * Swinger
 */

// #region

$(function() {
    initSwinger();
});

function initSwinger() {
    frameEvent();

    showLoading();
    setLoadingStatut("Chargement des éléments de l'interface..");
}

document.addEventListener('keydown', function (event) {
    let window = remote.getCurrentWindow();
    if ((event.key === 'I' || event.key === 'i') && event.ctrlKey && event.shiftKey) {
        //ipcRenderer.send('consoleAction', 'show/hide');
        window.webContents.openDevTools();
    }
    else if (isDev && ((event.key === 'R' || event.key === 'r') && event.ctrlKey && event.shiftKey)) {
        window.reload();
    }
});

$(document).on('click', 'a[href^="http"]', function(event) {
    event.preventDefault();
    shell.openExternal(this.href);
});

function closeLauncher() {
    const window = remote.getCurrentWindow();
    window.close();
}

function frameEvent() {
    const window = remote.getCurrentWindow();

    $("#frame-button-close").click(function() {
        closeLauncher();
    });

    $("#frame-button-restoredown").click(function() {
        if (window.isMaximized())
            window.unmaximize();
        else
            window.maximize();
    });

    $("#frame-button-minimize").click(function() {
        window.minimize();
    });
}

// Slider Functions
// #region

function bindRangeSlider() {
    Array.from(document.getElementsByClassName('range-slider')).map((v) => {
        const track = v.getElementsByClassName('range-slider-track')[0];

        const value = v.getAttribute('value');
        const sliderMeta = calculateRangeSliderMeta(v);

        updateRangedSlider(v, value, ((value-sliderMeta.min) / sliderMeta.step) * sliderMeta.inc);

        track.onmousedown = (e) => {
            document.onmouseup = (e) => {
                document.onmousemove = null;
                document.onmouseup = null;
            }

            document.onmousemove = (e) => {
                const diff = e.pageX - v.offsetLeft - track.offsetWidth / 2;
                if (diff >= 0 && diff <= v.offsetWidth-track.offsetWidth / 2) {
                    const perc = (diff / v.offsetWidth) * 100;
                    const notch = Number(perc / sliderMeta.inc).toFixed(0) * sliderMeta.inc
                    if (Math.abs(perc-notch) < sliderMeta.inc / 2)
                        updateRangedSlider(v, sliderMeta.min + (sliderMeta.step * (notch / sliderMeta.inc)), notch);
                }
            }
        }
    });
}

function calculateRangeSliderMeta(v) {
    const val = {
        max: Number(v.getAttribute('max')),
        min: Number(v.getAttribute('min')),
        step: Number(v.getAttribute('step')),
    }
    val.ticks = (val.max-val.min) / val.step;
    val.inc = 100 / val.ticks;
    return val;
}

function updateRangedSlider(element, value, notch) {
    const oldVal = element.getAttribute('value');
    const bar = element.getElementsByClassName('range-slider-bar')[0];
    const track = element.getElementsByClassName('range-slider-track')[0];

    element.setAttribute('value', value);

    if (notch < 0)
        notch = 0;
    else if(notch > 100)
        notch = 100;

    const event = new MouseEvent('change', {
        target: element,
        type: 'change',
        bubbles: false,
        cancelable: true
    });

    let cancelled = !element.dispatchEvent(event);
    if (!cancelled) {
        track.style.left = notch + '%';
        bar.style.width = notch + '%';
    }
    else
        element.setAttribute('value', oldVal);
}

// #endregion

// #endregion

// Loading panel Functions
// #region

function showLoading() {
    var splashes = [{text: "Pourquoi je suis la ????", author: "luuxis"}, {text: "3 ans plus tard", author: "luuxis"}, {text: "je sais pas quoi metre", author: "luuxis"}];

    var splashe_text = splashes[Math.floor(Math.random() * splashes.length)];
    $("#loading-splash-text").html(splashe_text.text);
    $("#loading-sudmitted-author").html('@' + splashe_text.author);

    var matrix = [];
    var line1 = ["none", "none", "none", "none", "none", "none", "none", "none", "none", "none", "none", "none", "none", "a62102", "a62102", "a62102"];
    var line2 = ["none", "none", "none", "none", "none", "none", "none", "none", "none", "none", "none", "none", "a62102", "fa9608", "f5d44f", "a62102"];
    var line3 = ["none", "none", "none", "none", "none", "none", "none", "none", "none", "none", "none", "a62102", "fa9608", "f5d44f", "fa9608", "a62102"];
    var line4 = ["none", "none", "none", "none", "none", "none", "none", "none", "none", "none", "a62102", "fa9608", "f5d44f", "fa9608", "a62102", "none"];
    var line5 = ["none", "none", "none", "none", "080808", "none", "none", "none", "none", "a62102", "fa9608", "f5d44f", "fa9608", "a62102", "none", "none"];
    var line6 = ["none", "none", "none", "080808", "080808", "none", "none", "a62102", "a62102", "fa9608", "f5d44f", "fa9608", "a62102", "none", "none", "none"];
    var line7 = ["none", "none", "080808", "080808", "080808", "none", "a62102", "fa9608", "fa9608", "f5d44f", "fa9608", "a62102", "none", "none", "none", "none"];
    var line8 = ["none", "none", "080808", "3b3837", "080808", "none", "a62102", "fa9608", "f5d44f", "fa9608", "a62102", "none", "none", "none", "none", "none"];
    var line9 = ["none", "none", "none", "080808", "3b3837", "a62102", "fa9608", "f5d44f", "fa9608", "fa9608", "a62102", "none", "none", "none", "none", "none"];
    var line10 = ["none", "none", "080808", "3b3837", "080808", "080808", "080808", "fa9608", "a62102", "a62102", "none", "none", "none", "none", "none", "none"];
    var line11 = ["none", "none", "080808", "3b3837", "080808", "6b6767", "080808", "a62102", "none", "none", "none", "none", "none", "none", "none", "none"];
    var line12 = ["none", "none", "none", "080808", "6b6767", "080808", "080808", "3b3837", "080808", "080808", "080808", "080808", "none", "none", "none", "none"];
    var line13 = ["none", "none", "3b3837", "6b6767", "080808", "3b3837", "3b3837", "080808", "3b3837", "080808", "080808", "none", "none", "none", "none", "none"];
    var line14 = ["080808", "080808", "6b6767", "3b3837", "none", "080808", "080808", "none", "080808", "080808", "none", "none", "none", "none", "none", "none"];
    var line15 = ["080808", "ff0600", "080808", "none", "none", "none", "none", "none", "none", "none", "none", "none", "none", "none", "none", "none"];
    var line16 = ["080808", "080808", "080808", "none", "none", "none", "none", "none", "none", "none", "none", "none", "none", "none", "none", "none"];

    matrix.push(line1);
    matrix.push(line2);
    matrix.push(line3);
    matrix.push(line4);
    matrix.push(line5);
    matrix.push(line6);
    matrix.push(line7);
    matrix.push(line8);
    matrix.push(line9);
    matrix.push(line10);
    matrix.push(line11);
    matrix.push(line12);
    matrix.push(line13);
    matrix.push(line14);
    matrix.push(line15);
    matrix.push(line16);

    $('.paladium-loader').show();
    for (var i = 0; i < 16; i++) {
        $('.paladium-loader').append('<div class="line" id="line-' + i + '"></div>');
        for (var j = 0; j < 16; j ++) {
            var type = matrix[i][j];
            var random = Math.floor((Math.random() * 5) + 0);
            $('#line-' + i).append('<div class="square square-' + random + '" data-color="' + type + '" id="line-' + (i + 1) + '-col-' + (j + 1) + '"></div>');
        }
    }
    $('.square').each(function() {
        var color = $(this).attr('data-color');
        if (color != "none")
            $(this).css('background-color', '#' + color);
    });
    $('#loading-view').fadeIn(500);
}

function hideLoading() {
    $('#loading-view').fadeOut(500);
}

function setLoadingStatut(text) {
    $("#loading-statut-text").html(text);
}

// #endregion
ion
