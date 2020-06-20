/**
 * Paladium Launcher - https://github.com/Paladium-Dev/Paladium-Launcher
 * Copyright (C) 2020 Paladium
 */

const AdmZip = require('adm-zip');
const child_process = require('child_process');
const crypto = require('crypto');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const { Library }  = require('./job_manager');
const ConfigManager = require('./config_manager');
const DistroManager = require('./distro_manager');
const LoggerUtil = require('./logger_util');

const logger = require('./logger_util')('paladium');

class ProcessBuilder {
    constructor(instance, versionData, forgeData, authUser, maxRam, minRam) {
        this.gameDir = path.join(ConfigManager.getInstanceDirectory(), instance.getID());
        this.commonDir = ConfigManager.getCommonDirectory();

        this.instance = instance;
        this.versionData = versionData;
        this.forgeData = forgeData;
        this.authUser = authUser;
        this.maxRam = maxRam;
        this.minRam = minRam;

        this.libPath = path.join(this.commonDir, 'libraries');
    }

    _getFiles(dir, files_) {
        files_ = files_ || [];
        if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir);

            for (let i in files) {
                const name = dir + '/' + files[i];
                if (fs.statSync(name).isDirectory())
                    this._getFiles(name, files_);
                else
                    files_.push(name);
            }
        }
        return files_;
    }

    _checkFile(file, files) {
        for (let f of files) {
            if (this.replaceAll(f, '/', '\\').includes(this.replaceAll(file, '/', '\\'))) {
                return true;
            }
        }
        return false;
    }

    replaceAll(str, find, replace) {
        return str.split(find).join(replace);
    }

    build() {
        let files_ex = [];
        files_ex = files_ex.concat(this._getFiles(ConfigManager.getInstanceDirectory()));
        files_ex = files_ex.concat(this._getFiles(this.libPath));

        let files = [];
        for (let ign of this.instance.getIgnored())
            files.push(path.join(this.gameDir, ign.path));
        for (let file of this._getFiles(path.join(this.gameDir, "config")))
            files.push(file);
        for (let file of this._getFiles(path.join(this.gameDir, "resourcepacks")))
            files.push(file);
        for (let file of this._getFiles(path.join(this.gameDir, "shaderpacks")))
            files.push(file);

        const instances = DistroManager.getDistribution().getInstances();

        for (let inst of instances) {
            for (let mdl of inst.getModules()) {
                files.push(mdl.getArtifact().getPath());

                if (mdl.hasSubModules()) {
                    for (let sm of mdl.getSubModules()) {
                        files.push(sm.getArtifact().getPath(), '/');
                    }
                }
            }
        }

        const libArr = this.versionData.libraries;
        for (let i = 0; i < libArr.length; i++) {
            const lib = libArr[i];
            console.log(lib);
            const blacklist = {
                linux : ["tv.twitch:twitch:5.16", "tv.twitch:twitch-platform:5.16", "tv.twitch:twitch-external-platform:4.5"],
                windows : [],
                mac : ["tv.twitch:twitch-external-platform:4.5"]
            };
            if(blacklist.linux.includes(lib.name) && Library.mojangFriendlyOS() === "linux") continue;
            if(blacklist.windows.includes(lib.name) && Library.mojangFriendlyOS() === "windows") continue;
            if(blacklist.mac.includes(lib.name) && Library.mojangFriendlyOS() === "osx") continue;

            if (lib.natives == null) {
                const dlInfo = lib.downloads;
                const artifact = dlInfo.artifact;

                files.push(path.join(this.libPath, artifact.path));
            }
            else {
                const classifier = lib.natives[Library.mojangFriendlyOS()].replace('${arch}', process.arch.replace('x', ''))
                const artifact = lib.downloads.classifiers[classifier];

                files.push(path.join(this.libPath, artifact.path));
            }
        }

        for (let file of files_ex) {
            if (!this._checkFile(file, files)) {
                fs.unlinkSync(file);
            }
        }

        logger.log("Build Paladium..");
        fs.ensureDirSync(this.gameDir);
        const tempNativePath = path.join(os.tmpdir(), ConfigManager.getTempNativeFolder(), crypto.pseudoRandomBytes(16).toString('hex'));

        process.throwDeprecation = true;

        let args = this.constructJVMArguments(tempNativePath);

        if (isDev) {
            logger.log("Launch Arguments: " + args);
        }

        const child = child_process.spawn(ConfigManager.getJavaExecutable(), args, {
            cwd: this.gameDir,
            detached: true
        });
        this.child = child;

        child.unref();

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (data) => {
            logger.log(data);
        });
        child.stderr.on('data', (data) => {
            logger.error(data);
        });

        child.on('close', (code, signal) => {
            this.child = null;
            logger.log("Exited with code " + code);
            fs.remove(tempNativePath, (err) => {
                if (err)
                    logger.warn('Error while deleting temp dir: ' + err);
                else
                    logger.log('Temp dir deleted successfully.');
            });
        });

        return child;
    }

    killProcess() {
        if (this.child){
            if (this.child.kill())
                logger.log("Process kill")
            else
                logger.error("The process won't be kill")
        }
        else
            logger.warn("No child process to kill !")
    }

    constructJVMArguments(tempNativePath) {
        let args = [];

        args.push('-cp');
        args.push(this.classpathArg(tempNativePath).join(process.platform === 'win32' ? ';' : ':'));

        if (process.platform === 'darwin') {
            args.push('-Xdock:name=Paladium');
            args.push('-Xdock:icon=' + path.join(__dirname, '..', 'images', 'minecraft.icns'));
        }

        args.push('-Xmx' + this.maxRam);
        args.push('-Xms' + this.minRam);
        args = args.concat(ConfigManager.getJVMOptions());

        args.push('-Djava.library.path=' + tempNativePath);
        args.push(this.forgeData.mainClass);
        args = args.concat(this._resolveForgeArgs());

        return args;
    }

    _resolveForgeArgs() {
        const mcArgs = this.forgeData.minecraftArguments.split(' ');
        const argDiscovery = /\${*(.*)}/;

        for (let i = 0; i < mcArgs.length; ++i) {
            if (argDiscovery.test(mcArgs[i])) {
                const identifier = mcArgs[i].match(argDiscovery)[1];
                let val = null;

                switch (identifier) {
                    case 'auth_player_name': {
                        val = this.authUser.displayName.trim();
                        break;
                    }
                    case 'version_name': {
                        val = this.instance.getMinecraftVersion();
                        break;
                    }
                    case 'game_directory': {
                        val = this.gameDir;
                        break;
                    }
                    case 'assets_root': {
                        val = path.join(this.commonDir, 'assets');
                        break;
                    }
                    case 'assets_index_name': {
                        val = this.versionData.assets;
                        break;
                    }
                    case 'auth_uuid': {
                        val = this.authUser.uuid.trim();
                        break;
                    }
                    case 'auth_access_token': {
                        val = this.authUser.accessToken;
                        break;
                    }
                    case 'user_properties': {
                        val = '{}';
                        break;
                    }
                    case 'user_type': {
                        val = 'mojang';
                        break;
                    }
                }

                if (val != null)
                    mcArgs[i] = val;
            }
        }

        mcArgs.push('--width');
        mcArgs.push('1280');
        mcArgs.push('--height');
        mcArgs.push('720');

        return mcArgs;
    }

    classpathArg(tempNativePath) {
        let cpArgs = [];

        const version = this.versionData.id;
        cpArgs.push(path.join(this.commonDir, 'versions', version, version + '.jar'));

        const mojangLibs = this._resolveMojangLibraries(tempNativePath);
        cpArgs = cpArgs.concat(mojangLibs);

        const instLibs = this._resolveInstanceLibraries();
        cpArgs = cpArgs.concat(instLibs);

        const instMods = this._resolveInstanceMods();
        cpArgs = cpArgs.concat(instMods);

        return cpArgs;
    }

    _resolveMojangLibraries(tempNativePath) {
        const libs = [];
        const libArr = this.versionData.libraries;
        fs.ensureDirSync(tempNativePath);
        for (let i = 0; i < libArr.length; i++) {
            const lib = libArr[i];

            if (lib.natives == null) {
                const dlInfo = lib.downloads;
                const artifact = dlInfo.artifact;
                const to = path.join(this.libPath, artifact.path);

                if (!this._checkLibraries(artifact.path)) {
                    libs.push(to);
                }
            }
            else {
                // Extract the native library.
                if (lib.natives[Library.mojangFriendlyOS()] == undefined) {
                    logger.warn('Skip missing platform native: ' + lib.name);
                }
                else {
                    const exclusionArr = lib.extract != null ? lib.extract.exclude : ['META-INF/'];
                    const classifier = lib.natives[Library.mojangFriendlyOS()].replace('${arch}', process.arch.replace('x', ''))
                    const artifact = lib.downloads.classifiers[classifier];

                    if (artifact == undefined) {
                        logger.warn('Skip missing platform native: ' + lib.name + ", " + classifier);
                    }
                    else {
                        // Location of native zip.
                        const to = path.join(this.libPath, artifact.path);

                        let zip = new AdmZip(to);
                        let zipEntries = zip.getEntries();

                        // Unzip the native zip.
                        for (let i = 0; i < zipEntries.length; i++) {
                            const fileName = zipEntries[i].entryName;

                            let shouldExclude = false;

                            // Exclude noted files.
                            exclusionArr.forEach(function(exclusion) {
                                if (fileName.indexOf(exclusion) > -1)
                                    shouldExclude = true;
                            })

                            // Extract the file.
                            if (!shouldExclude) {
                                fs.writeFile(path.join(tempNativePath, fileName), zipEntries[i].getData(), (err) => {
                                    if (err) {
                                        logger.error('Error while extracting native library: ' + err);
                                    }
                                });
                            }
                        }
                    }
                }
            }
        }
        return libs;
    }

    _checkLibraries(value) {
        const mdls = this.instance.getModules();

        for (let mdl of mdls) {
            if (mdl.getType() === DistroManager.Types.ForgeHosted) {
                if (mdl.getID().includes(value) && !mdl.hasSubModules()) {
                    return true;
                }
                else if (mdl.hasSubModules()) {
                    for (let sm of mdl.getSubModules()) {
                        if (value.includes(sm.getID()))
                            return true;
                    }
                }
            }
        }
        return false;
    }

    _resolveInstanceLibraries() {
        const mdls = this.instance.getModules();
        let libs = [];

        // Locate Forge/Libraries
        for (let mdl of mdls) {
            const type = mdl.getType();
            if (type === DistroManager.Types.ForgeHosted || type === DistroManager.Types.Library) {
                libs.push(mdl.getArtifact().getPath());

                if (mdl.hasSubModules()) {
                    const res = this._resolveModuleLibraries(mdl);
                    if (res.length > 0)
                        libs = libs.concat(res);
                }
            }
            else if (type === DistroManager.Types.ForgeMod && mdl.hasSubModules()) {
                const res = this._resolveModuleLibraries(mdl);
                if (res.length > 0)
                    libs = libs.concat(res);
            }
        }
        return libs;
    }

    _resolveModuleLibraries(mdl) {
        if (!mdl.hasSubModules())
            return [];
        let libs = [];
        for (let sm of mdl.getSubModules()) {
            if (sm.getType() === DistroManager.Types.Library) {
                libs.push(sm.getArtifact().getPath());
            }
            if (mdl.hasSubModules()) {
                const res = this._resolveModuleLibraries(sm);
                if (res.length > 0)
                    libs = libs.concat(res);
            }
        }
        return libs;
    }

    _resolveInstanceMods() {
        const mdls = this.instance.getModules();
        let mods = [];

        for (let mdl of mdls) {
            const type = mdl.getType();
            if (type === DistroManager.Types.ForgeMod || type === DistroManager.Types.PalaMod) {
                if (mdl.hasSubModules()) {
                    const res = this._resolveModuleMods(mdl);
                    if (res.length > 0)
                        mods = mods.concat(res);
                }
            }
        }
        return mods;
    }

    _resolveModuleMods(mdl) {
        if (!mdl.hasSubModules())
            return [];
        let mods = [];
        for (let sm of mdl.getSubModules()) {
            if (sm.getType() === DistroManager.Types.Library) {
                mods.push(sm.getArtifact().getPath());
                if (mdl.hasSubModules()) {
                    const res = this._resolveModuleMods(sm);
                    if (res.length > 0)
                        mods = mods.concat(res);
                }
            }
        }
        return mods;
    }
}
module.exports = ProcessBuilder;
