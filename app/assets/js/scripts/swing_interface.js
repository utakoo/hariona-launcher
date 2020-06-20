/**
 * Paladium Launcher - https://github.com/Paladium-Dev/Paladium-Launcher
 * Copyright (C) 2020 Paladium
 */

let currentView;
let previousView;

const VIEWS = {
    login: '#login-view',
    launcher: '#launcher-view',
    settings: '#settings-view'
}

function switchView(current, next, onNextFade = () => {}) {
    previousView = currentView;
    currentView = next;

    $(`${current}`).hide();
    $(`${next}`).fadeIn(500, () => {
        onNextFade();
    });
}

function getCurrentView() {
    return currentView;
}

function showMainUI(view) {
    setTimeout(() => {
        $('#main').show();

        previousView = currentView;
        currentView = view;
        $(view).fadeIn(1000);
    }, 750);
}