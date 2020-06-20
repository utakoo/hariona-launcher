/**
 * Paladium Launcher - https://github.com/Paladium-Dev/Paladium-Launcher
 * Copyright (C) 2020 Paladium
 */

function initSettingsUserCompteTab() {
    const selectedAcc = ConfigManager.getSelectedAccount();
    $("#settings-user-compte-displayname-label").html(selectedAcc.displayName);
    $("#settings-user-compte-username-label").html(selectedAcc.username);
    $("#settings-user-compte-profile").css("background-image", "url('https://mc-heads.net/head/" + selectedAcc.displayName + "')");
}

$("#settings-user-logout-button").click(function() {
    setOverlayContent('Se déconnecter',
        'Êtes-vous sûr de vouloir vous déconnecter ?'
        + '<br><br><div class=\"warning-bar\"><i class=\"fas fa-exclamation-triangle\"></i> Il faudra de nouveau rentrer vos indentifiant (email + mot de passe) pour vous reconnecter.</div>',
        'Retour', 'Se déconnecter');
    toggleOverlay(true);

    setCloseHandler();
    setActionHandler(() => {
        toggleOverlay(false);

        ConfigManager.removeAuthAccount(ConfigManager.getSelectedAccount().uuid);
        ConfigManager.save();

        switchView(getCurrentView(), VIEWS.login);
    });
});