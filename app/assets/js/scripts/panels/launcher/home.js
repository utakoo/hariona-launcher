/**
 * Paladium Launcher - https://github.com/Paladium-Dev/Paladium-Launcher
 * Copyright (C) 2020 Paladium
 */

const $launcherHomePlayButton = $('#launcher-home-play-button');

function initLauncherHomePanel() {
    refreshServer();
    refreshLauncherUserCompte();
}

$("#launcher-home-options-button").click(function() {
    switchView(getCurrentView(), VIEWS.settings);
    initSettings();
});

$launcherHomePlayButton.click(function() {
    gameUpdate();
});

document.addEventListener('keydown', (e) => {
    if (getCurrentView() === VIEWS.launcher && currentLauncherPanel === LAUNCHER_PANELS.home) {
        if (e.key === 'Enter' && $launcherHomePlayButton.attr("disabled") != "disabled")
             gameUpdate();
    }
});

function refreshServer() {
    var paladium_server = require('./assets/js/server_status');
    paladium_server.init('proxy.paladium-pvp.fr', 25565, function(result) {
        if (paladium_server.online) {
            $("#server-paladium-players").html(paladium_server.current_players);
            $("#server-paladium-latency").html(paladium_server.latency);

            $("#server-total-players").html(paladium_server.current_players + " <i class=\"online\"></i>");
        }
        else
            $("#server-total-players").html("0 <i class=\"offline\"></i>");
    });
}

function refreshLauncherUserCompte() {
    const selectedAcc = ConfigManager.getSelectedAccount();
    $("#launcher-user-compte-displayname-label").html(selectedAcc.displayName);
    $("#launcher-user-compte-profile").css("background-image", "url('https://mc-heads.net/avatar/" + selectedAcc.displayName + "')");
}

// Game update Functions
// #region

let aEx;
let progressListener;
let versionData;
let forgeData;
let maxRam;
let minRam;

function checkValideRam() {
    let free_ram = Number(os.freemem() / 1000000000).toFixed(1);
    let configMaxRam = ConfigManager.getMaxRAM();
    let configMinRam = ConfigManager.getMinRAM();

    if (configMaxRam.endsWith('M')) {
        configMaxRam = Number(configMaxRam.substring(0, configMaxRam.length - 1)) / 1000;
    }
    else {
        configMaxRam = Number.parseFloat(configMaxRam);
    }
    if (configMinRam.endsWith('M')) {
        configMinRam = Number(configMinRam.substring(0, configMinRam.length - 1)) / 1000;
    }
    else {
        configMinRam = Number.parseFloat(configMinRam);
    }

    if (configMaxRam > free_ram) {
        maxRam = free_ram - 0.5;
    }
    else {
        maxRam = configMaxRam;
    }
    if (configMinRam > free_ram || configMinRam > configMaxRam) {
        minRam = 0.5;
    }
    else {
        minRam = configMinRam;
    }

    if (maxRam < 0.5)
        return false;

    if (maxRam % 1 > 0)
        maxRam = Math.round(maxRam * 1000) + 'M';
    else
        maxRam = Math.round(maxRam) + 'G';
    if (minRam % 1 > 0)
        minRam = Math.round(minRam * 1000) + 'M';
    else
        minRam = Math.round(minRam) + 'G';
    return true;
}

function gameUpdate() {
    if (!checkValideRam() && process.platform == 'win32') {
        setOverlayContent("Mémoire insuffisante !",
            "Vous n'avez pas assez de RAM disponible pour lancer le jeu !"
            + "<br><br><div class=\"info-bar\"><i class=\"fas fa-info-circle\"></i> Vous pouvez libérer de la RAM en fermant les applications ouvertes sur votre ordinateur. (Paladium nécessite 1 Go de RAM)</div>",
            'Retour');
        toggleOverlay(true);
        setCloseHandler();
        return;
    }
    else {
        maxRam = ConfigManager.getMaxRAM();
        minRam = ConfigManager.getMinRAM();
    }

    setGameUpdateOverlayContent();
    setGameTaskProgress();

    setGameUpdateOverlayDownloadProgress(0);
    setGameUpdateOverlayDownload("Recherche de mise à jour..");

    const loggerAEx = LoggerUtil('launcher');

    const forkEnv = JSON.parse(JSON.stringify(process.env));
    forkEnv.CONFIG_DIRECT_PATH = ConfigManager.getLauncherDirectory();

    aEx = cp.fork(path.join(__dirname, 'assets', 'js', 'job_manager_exec.js'), [
        'JobManager',
        ConfigManager.getCommonDirectory(),
        ConfigManager.getJavaExecutable()
    ], {
        env: forkEnv,
        stdio: 'pipe'
    });
    // Stdout
    aEx.stdio[1].setEncoding('utf8');
    aEx.stdio[1].on('data', (data) => {
        loggerAEx.log(data);
    });
    // Stderr
    aEx.stdio[2].setEncoding('utf8')
    aEx.stdio[2].on('data', (data) => {
        loggerAEx.log(data);
    });
    aEx.on('error', (err) => {
        loggerAEx.error("Error during launch: " + err);
    });
    aEx.on('close', (code, signal) => {
        if (code !== 0) {
            loggerAEx.error(`DownloadManager exited with code ${code}, assuming error.`);
        }
    });

    aEx.on('message', (m) => {
        if (m.context === 'validate') {
            switch (m.data) {
                case 'distribution': {
                    setGameUpdateOverlayDownload("Vérification de la version..");
                    break;
                }
                case 'version': {
                    setGameUpdateOverlayDownload("Vérification des assets..");
                    break;
                }
                case 'assets': {
                    setGameUpdateOverlayDownload("Vérification des libraries..");
                    break;
                }
                case 'libraries': {
                    setGameUpdateOverlayDownload("Vérification des fichiers..");
                    break;
                }
                case 'files': {
                    setGameUpdateOverlayDownload("Téléchargement des fichiers en cours..");
                    break;
                }
            }
        }
        else if (m.context === 'progress') {
            switch  (m.data) {
                case 'assets': {
                    const perc = (m.value / m.total) * 20;
                    setDownloadPercentage(40 + perc, 100, parseInt(40 + perc));
                    break;
                }
                case 'download': {
                    setDownloadPercentage(m.value, m.total, m.percent);
                    break;
                }
            }
        }
        else if (m.context === 'complete') {
            switch (m.data) {
                case 'download': {
                    if (progressListener != null) {
                        clearInterval(progressListener);
                        progressListener = null;
                    }
                    setGameUpdateOverlayDownload("Chargement en cours..");
                    break;
                }
            }
        }
        else if (m.context === 'error') {
            switch (m.data) {
                case 'download': {
                    loggerAEx.error("Error while downloading:");
                    loggerAEx.error(m.error);
                    aEx.disconnect();

                    setGameTaskProgress(false);
                    setOverlayContent('Mise à jour échouée !',
                        'Une erreur s\'est produite lors de la mise à jour du jeu.'
                        + '<br>Nous vous conseillons de réessayer la mise à jour avec le bouton ci-dessous.',
                        'Annuler', 'Réessayer');
                    toggleOverlay(true);
                    setCloseHandler();
                    setActionHandler(() => {
                        toggleOverlay(false);
                        gameUpdate();
                    });
                    break;
                }
            }
        }
        else if (m.context === 'validateEverything') {
            if (m.result.forgeData == null || m.result.versionData == null) {
                console.error("Error during validation: ", m.result);
                console.error("Error during launch: ", m.result.error);

                loggerAEx.error(`Error during validation! {forgeData:${forgeData}, versionData:${versionData}}`);

                aEx.disconnect();
                return;
            }

            forgeData = m.result.forgeData;
            versionData = m.result.versionData;

            aEx.disconnect();
            gameBuilder();
        }
    });

    aEx.send({task: 'execute', function: 'validateEverything', argsArr: [ConfigManager.getSelectedInstance()]});
}

function gameBuilder() {
    const loggerLaunchSuite = LoggerUtil('builder');

    setGameUpdateOverlayDownload("Lancement du jeu en cours..");
    setGameUpdateOverlayTitle("Lancement du jeu");
    setGameUpdateOverlayDownloadProgress(100);

    const gameStateChange = function(data) {
        if (data.trim().match(/OpenAL initialized./i)) {
            const window = remote.getCurrentWindow();
            window.close();
        }
    }

    const gameErrorListener = function(data) {
        // TODO : Ajouter d'autre event d'erreur.

        data = data.trim();
        if (data.indexOf('Could not find or load main class net.minecraft.launchwrapper.Launch') > -1) {
            console.error('Game launch failed, LaunchWrapper was not downloaded properly.');
        }
    }

    const gameCloseListener = function(code, signal) {
        const window = remote.getCurrentWindow();
        window.show();
        window.focus();

        setGameTaskProgress(false);

        if (code != 0) {
            setOverlayContent('Crash du jeu !',
                'Une erreur s\'est produite pendant l\'exécution du jeu.',
                'Fermer');
            toggleOverlay(true);
            setCloseHandler();
        }
    }

    const instance = DistroManager.getDistribution().getInstance(ConfigManager.getSelectedInstance());
    const authUser = ConfigManager.getSelectedAccount();
    loggerLaunchSuite.log(`Sending selected account (${authUser.displayName}) to ProcessBuilder.`)

    minecraftProcess = new ProcessBuilder(instance, versionData, forgeData, authUser, maxRam, minRam);
    try {
        proc = minecraftProcess.build();
        proc.stderr.on('data', gameErrorListener);
        proc.stdout.on('data', gameStateChange);
        proc.on('close', gameCloseListener);
    }
    catch (exception) {
        console.error("Error during launch!", exception);
        loggerLaunchSuite.error("Error during launch! " + exception);
        setGameTaskProgress(false);

        setOverlayContent('Crash du jeu !',
            'Une erreur s\'est produite pendant l\'exécution du jeu.',
            'Fermer');
        toggleOverlay(true);
        setCloseHandler();
    }
}

function setGameTaskProgress(value = true) {
    if (value) {
        toggleGameUpdateOverlay(true);
        $(VIEWS.launcher).fadeOut(1000);
        $("#launcher-home-play-button").attr("disabled", true);
    }
    else {
        $(VIEWS.launcher).fadeIn(1000);
        toggleGameUpdateOverlay(false);
        $("#launcher-home-play-button").attr("disabled", false);
    }
}

function setDownloadPercentage(value, max, percent = ((value / max) * 100)) {
    setGameUpdateOverlayDownloadProgress(percent);
}

// #endregion