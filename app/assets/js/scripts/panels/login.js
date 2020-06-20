/**
 * Paladium Launcher - https://github.com/Paladium-Dev/Paladium-Launcher
 * Copyright (C) 2020 Paladium
 */

const loginForm = document.getElementById('login-form');
const loginUsernameTextField = document.getElementById('login-username-textfield');
const loginPasswordTextField = document.getElementById('login-password-textfield');
const loginButton = document.getElementById('login-button');

const basicEmail = /^\S+@\S+\.\S+$/;

loginForm.onsubmit = () => {
    return false;
}

loginButton.addEventListener('click', () => {
    onLogin();
});

document.addEventListener('keydown', (e) => {
    if (getCurrentView() === VIEWS.login && !loginUsernameTextField.disabled) {
        if (e.key === 'Enter')
            onLogin();
    }
});

$("#login-email-help").click(function() {
    setOverlayContent('Aide',
        "Utilisez votre adresse e-mail de votre compte Mojang."
        + "<br><br><div class=\"warning-bar\"><i class=\"fas fa-exclamation-triangle\"></i> Si votre compte a été créé avant novembre 2012, vous devez <br><a href=\"https://account.mojang.com/migrate\">migrer votre compte</a>.</div>",
        'Retour');
    toggleOverlay(true);
    setCloseHandler();
});

function showLoginError(title, value) {
    setOverlayContent(title,
        value,
        'Retour');
    toggleOverlay(true);
    setCloseHandler();
}

function onLogin() {
    if (loginUsernameTextField.value && loginPasswordTextField.value) {
        if (!basicEmail.test(loginUsernameTextField.value)) {
            showLoginError("Adresse email non valide !", "Merci de vérifier votre adresse email.");
            return;
        }
    }
    else {
        return;
    }
    formDisabled(true);

    AuthManager.addAccount(loginUsernameTextField.value, loginPasswordTextField.value).then((value) => {
        setTimeout(() => {
            switchView(getCurrentView(), VIEWS.launcher, () => {
                loginUsernameTextField.value = '';
                loginPasswordTextField.value = '';
                formDisabled(false);
            });
            initLauncherView();
        }, 1000);
    }).catch((err) => {
        formDisabled(false);
        loginPasswordTextField.value = '';

        const errF = resolveError(err);
        showLoginError(errF.title, errF.desc);
    });
}

function resolveError(err) {
    if (err.cause != null && err.cause === 'UserMigratedException') {
        return {
            title: "Échec d'authentification !",
            desc: "Vous avez tenté de vous connecter avec un compte migré. <br><br>Essayez à nouveau en utilisant l'adresse e-mail du compte."
        }
    }
    else {
        if (err.error != null) {
            if (err.error === 'ForbiddenOperationException') {
                if (err.errorMessage != null) {
                    if (err.errorMessage === 'Invalid credentials. Invalid username or password.') {
                        return {
                            title: "Échec d'authentification !",
                            desc: "L'adresse e-mail ou le mot de passe que vous avez entré est incorrect. <br><br>Veuillez réessayer."
                        }
                    }
                    else if (err.errorMessage === 'Invalid credentials.') {
                        return {
                            title: "Trop de tentative de connexion !",
                            desc: "Il y a eu trop de tentatives de connexion avec ce compte récemment. <br><br>Veuillez réessayer plus tard."
                        }
                    }
                }
            }
        }
        else {
            if (err.code != null) {
                if (err.code === 'ENOENT') {
                    // No Internet.
                    return {
                        title: "Aucune connexion Internet !",
                        desc: "Vous devez être connecté à Internet pour pouvoir vous connecter. <br>Veuillez vous connecter et réessayer."
                    }
                }
                else if (err.code === 'ENOTFOUND') {
                    // Could not reach server.
                    return {
                        title: "Serveur d'authentification non disponible !",
                        desc: "Le serveur d'authentification de Mojang est actuellement hors ligne ou inaccessible. <br>S'il vous plaît attendez un peu et essayez à nouveau. <br><br>Vous pouvez vérifier l’état du serveur sur <a href=\"https://help.mojang.com/\">Mojang's help portal</a>."
                    }
                }
                else if (err.code === "SELF_SIGNED_CERT_IN_CHAIN"){
                    return {
                        title: "Erreur de sécurité !",
                        desc: "Le serveur d'authentification de Mojang n'a pas pu être validé...<br><br>S'il vous plaît essayez de désactiver votre antivirus/firewall pour le Launcher<br><br>Cete erreur se produit aussi si vous utilisez un logiciel pour avoir des comptes Minecraft gratuitement ! Ils sont interdit et peuvent porter atteinte à votre ordinateur"

                    }
                }
            }
        }
    }
    return {
        title : "Erreur inconnu lors de l'authentification !",
        desc : err,
    }
}

function formDisabled(value) {
    loginDisabled(value);
    loginUsernameTextField.disabled = value;
    loginPasswordTextField.disabled = value;
}

function loginDisabled(value) {
    if (loginButton.disabled !== value)
        loginButton.disabled = value;
    if (value)
        $('#login-button-loader').show();
    else
        $('#login-button-loader').hide();
}