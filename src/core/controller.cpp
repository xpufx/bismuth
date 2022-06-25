// SPDX-FileCopyrightText: 2022 Mikhail Zolotukhin <mail@gikari.com>
//
// SPDX-License-Identifier: MIT

#include "controller.hpp"

#include <KGlobalAccel>
#include <KLocalizedString>

#include <QAction>
#include <QDebug>
#include <QObject>

#include <memory>

#include "config.hpp"
#include "engine/engine.hpp"
#include "logger.hpp"
#include "plasma-api/client.hpp"
#include "plasma-api/workspace.hpp"
#include "ts-proxy.hpp"

namespace Bismuth
{
Controller::Controller(PlasmaApi::Api &api, Engine &engine, const Bismuth::Config &config)
    : m_plasmaApi(api)
    , m_proxy()
    , m_engine(engine)
    , m_config(config)
{
    bindEvents();
    if (m_config.experimentalBackend()) {
        registerShortcuts();
        loadExistingWindows();
    }
}

void Controller::bindEvents()
{
    auto &workspace = m_plasmaApi.workspace();
    connect(&workspace, &PlasmaApi::Workspace::currentDesktopChanged, this, &Controller::onCurrentSurfaceChanged);
    connect(&workspace, &PlasmaApi::Workspace::numberScreensChanged, this, &Controller::onSurfaceUpdate);
    connect(&workspace, &PlasmaApi::Workspace::screenResized, this, &Controller::onSurfaceUpdate);
    connect(&workspace, &PlasmaApi::Workspace::currentActivityChanged, this, &Controller::onCurrentSurfaceChanged);
    connect(&workspace, &PlasmaApi::Workspace::clientAdded, this, &Controller::onClientAdded);
    connect(&workspace, &PlasmaApi::Workspace::clientRemoved, this, &Controller::onClientRemoved);
    connect(&workspace, &PlasmaApi::Workspace::clientMaximizeSet, this, [this](PlasmaApi::Client client, bool h, bool v) {
        if (h == true && v == true) {
            onClientMaximized(client);
        } else if (h == false && v == false) {
            onClientUnmaximized(client);
        }
    });
    connect(&workspace, &PlasmaApi::Workspace::clientMinimized, this, &Controller::onClientMinimized);
    connect(&workspace, &PlasmaApi::Workspace::clientUnminimized, this, &Controller::onClientUnminimized);
}

void Controller::registerShortcuts()
{
    auto addShortcut = [&](const QString &id, const QString &description, const QString &defaultKeybinding, std::function<void()> callback) {
        auto action = new QAction(this);
        action->setProperty("componentName", QStringLiteral("bismuth"));
        action->setProperty("componentDisplayName", i18n("Window Tiling"));
        action->setObjectName(id);
        action->setText(description);

        // Register the keybinding as the default. This is needed for KCM to
        // recognize it as such, so that it can properly show whether it is changed
        // from the default.
        KGlobalAccel::self()->setDefaultShortcut(action, {QKeySequence(defaultKeybinding)});

        // How this function works:
        // Set the shortcut from the global shortcuts configuration, or set it to
        // the provided value if it is not found in the config
        KGlobalAccel::self()->setShortcut(action, {QKeySequence(defaultKeybinding)});

        QObject::connect(action, &QAction::triggered, callback);
    };

    addShortcut("focus_next_window", "Focus Next Window", "", [=]() {
        qDebug(Bi) << "Focus Next Window Triggered!";
        m_engine.focusWindowByOrder(Engine::FocusOrder::Next);
    });
    addShortcut("focus_prev_window", "Focus Previous Window", "", [=]() {
        qDebug(Bi) << "Focus Previous Window Triggered!";
        m_engine.focusWindowByOrder(Engine::FocusOrder::Previous);
    });

    addShortcut("focus_upper_window", "Focus Upper Window", "Meta+K", [=]() {
        qDebug(Bi) << "Focus Upper Window Triggered!";
    });
    addShortcut("focus_bottom_window", "Focus Bottom Window", "Meta+J", [=]() {
        qDebug(Bi) << "Focus Bottom Window Triggered!";
    });
    addShortcut("focus_left_window", "Focus Left Window", "Meta+H", [=]() {
        qDebug(Bi) << "Focus Left Window Triggered!";
    });
    addShortcut("focus_right_window", "Focus Right Window", "Meta+L", [=]() {
        qDebug(Bi) << "Focus Right Window Triggered!";
    });

    addShortcut("move_window_to_next_pos", "Move Window to the Next Position", "", [=]() {
        qDebug(Bi) << "Move Window to the Next Position Triggered!";
    });
    addShortcut("move_window_to_prev_pos", "Move Window to the Previous Position", "", [=]() {
        qDebug(Bi) << "Move Window to the Previous Position Triggered!";
    });

    addShortcut("move_window_to_upper_pos", "Move Window Up", "Meta+Shift+K", [=]() {
        qDebug(Bi) << "Move Window Up Triggered!";
    });
    addShortcut("move_window_to_bottom_pos", "Move Window Down", "Meta+Shift+J", [=]() {
        qDebug(Bi) << "Move Window Down Triggered!";
    });
    addShortcut("move_window_to_left_pos", "Move Window Left", "Meta+Shift+H", [=]() {
        qDebug(Bi) << "Move Window Left Triggered!";
    });
    addShortcut("move_window_to_right_pos", "Move Window Right", "Meta+Shift+L", [=]() {
        qDebug(Bi) << "Move Window Right Triggered!";
    });

    addShortcut("move_window_to_upper_surf", "Move Window Up Surface", "Meta+Alt+K", [=]() {
        qDebug(Bi) << "Move Window Up Surface Triggered!";
    });
    addShortcut("move_window_to_bottom_surf", "Move Window Down Surface", "Meta+Alt+J", [=]() {
        qDebug(Bi) << "Move Window Down Surface Triggered!";
    });
    addShortcut("move_window_to_left_surf", "Move Window Left Surface", "Meta+Alt+H", [=]() {
        qDebug(Bi) << "Move Window Left Surface Triggered!";
    });
    addShortcut("move_window_to_right_surf", "Move Window Right Surface", "Meta+Alt+L", [=]() {
        qDebug(Bi) << "Move Window Right Surface Triggered!";
    });

    addShortcut("increase_window_width", "Increase Window Width", "Meta+Ctrl+L", [=]() {
        qDebug(Bi) << "Increase Window Width Triggered!";
    });
    addShortcut("increase_window_height", "Increase Window Height", "Meta+Ctrl+J", [=]() {
        qDebug(Bi) << "Increase Window Height Triggered!";
    });

    addShortcut("decrease_window_width", "Decrease Window Width", "Meta+Ctrl+H", [=]() {
        qDebug(Bi) << "Decrease Window Width Triggered!";
    });
    addShortcut("decrease_window_height", "Decrease Window Height", "Meta+Ctrl+K", [=]() {
        qDebug(Bi) << "Decrease Window Height Triggered!";
    });

    addShortcut("increase_master_win_count", "Increase Master Area Window Count", "Meta+]", [=]() {
        qDebug(Bi) << "Increase Master Area Window Count Triggered!";
    });
    addShortcut("decrease_master_win_count", "Decrease Master Area Window Count", "Meta+[", [=]() {
        qDebug(Bi) << "Decrease Master Area Window Count Triggered!";
    });

    addShortcut("increase_master_size", "Increase Master Area Size", "", [=]() {
        qDebug(Bi) << "Increase Master Area Size Triggered!";
    });
    addShortcut("decrease_master_size", "Decrease Master Area Size", "", [=]() {
        qDebug(Bi) << "Decrease Master Area Size Triggered!";
    });

    addShortcut("toggle_window_floating", "Toggle Active Window Floating", "Meta+F", [=]() {
        qDebug(Bi) << "Toggle Active Window Floating Triggered!";
    });

    addShortcut("push_window_to_master", "Push Active Window to Master Area", "Meta+Return", [=]() {
        qDebug(Bi) << "Push Active Window to Master Area Triggered!";
    });

    addShortcut("next_layout", "Switch to the Next Layout", "Meta+\\", [=]() {
        qDebug(Bi) << "Switch to the Next Layout Triggered!";
    });
    addShortcut("prev_layout", "Switch to the Previous Layout", "Meta+|", [=]() {
        qDebug(Bi) << "Switch to the Previous Layout Triggered!";
    });

    addShortcut("toggle_tile_layout", "Toggle Tile Layout", "Meta+T", [=]() {
        qDebug(Bi) << "Toggle Tile Layout Triggered!";
    });
    addShortcut("toggle_monocle_layout", "Toggle Monocle Layout", "Meta+M", [=]() {
        qDebug(Bi) << "Toggle Monocle Layout Triggered!";
    });

    addShortcut("rotate", "Rotate Layout Clockwise", "Meta+R", [=]() {
        qDebug(Bi) << "Rotate Layout Clockwise Triggered!";
    });
    addShortcut("rotate_reverse", "Rotate Layout Counterclockwise", "", [=]() {
        qDebug(Bi) << "Rotate Layout Counterclockwise Triggered!";
    });
    addShortcut("rotate_part", "Rotate Sublayout Clockwise", "Meta+Shift+R", [=]() {
        qDebug(Bi) << "Rotate Sublayout Clockwise Triggered!";
    });

    addShortcut("swap_group_1_surface", "Swap Group 1 to Active Monitor", "Meta+Shift+1", [=]() {
        qDebug(Bi) << "Swap Group 1 to Active Monitor Triggered!";
    });
    addShortcut("swap_group_2_surface", "Swap Group 2 to Active Monitor", "Meta+Shift+2", [=]() {
        qDebug(Bi) << "Swap Group 2 to Active Monitor Triggered!";
    });
    addShortcut("swap_group_3_surface", "Swap Group 3 to Active Monitor", "Meta+Shift+3", [=]() {
        qDebug(Bi) << "Swap Group 3 to Active Monitor Triggered!";
    });
    addShortcut("swap_group_4_surface", "Swap Group 4 to Active Monitor", "Meta+Shift+4", [=]() {
        qDebug(Bi) << "Swap Group 4 to Active Monitor Triggered!";
    });
    addShortcut("swap_group_5_surface", "Swap Group 5 to Active Monitor", "Meta+Shift+5", [=]() {
        qDebug(Bi) << "Swap Group 5 to Active Monitor Triggered!";
    });
    addShortcut("swap_group_6_surface", "Swap Group 6 to Active Monitor", "Meta+Shift+6", [=]() {
        qDebug(Bi) << "Swap Group 6 to Active Monitor Triggered!";
    });
    addShortcut("swap_group_7_surface", "Swap Group 7 to Active Monitor", "Meta+Shift+7", [=]() {
        qDebug(Bi) << "Swap Group 7 to Active Monitor Triggered!";
    });
    addShortcut("swap_group_8_surface", "Swap Group 8 to Active Monitor", "Meta+Shift+8", [=]() {
        qDebug(Bi) << "Swap Group 8 to Active Monitor Triggered!";
    });
    addShortcut("swap_group_9_surface", "Swap Group 9 to Active Monitor", "Meta+Shift+9", [=]() {
        qDebug(Bi) << "Swap Group 9 to Active Monitor Triggered!";
    });
    addShortcut("swap_group_10_surface", "Swap Group 10 to Active Monitor", "Meta+Shift+0", [=]() {
        qDebug(Bi) << "Swap Group 10 to Active Monitor Triggered!";
    });
    addShortcut("swap_group_11_surface", "Swap Group 11 to Active Monitor", "Meta+Hyper+1", [=]() {
        qDebug(Bi) << "Swap Group 11 to Active Monitor Triggered!";
    });
    addShortcut("swap_group_12_surface", "Swap Group 12 to Active Monitor", "Meta+Hyper+2", [=]() {
        qDebug(Bi) << "Swap Group 12 to Active Monitor Triggered!";
    });
    addShortcut("swap_group_13_surface", "Swap Group 13 to Active Monitor", "Meta+Hyper+3", [=]() {
        qDebug(Bi) << "Swap Group 13 to Active Monitor Triggered!";
    });
    addShortcut("swap_group_14_surface", "Swap Group 14 to Active Monitor", "Meta+Hyper+4", [=]() {
        qDebug(Bi) << "Swap Group 14 to Active Monitor Triggered!";
    });
    addShortcut("swap_group_15_surface", "Swap Group 15 to Active Monitor", "Meta+Hyper+5", [=]() {
        qDebug(Bi) << "Swap Group 15 to Active Monitor Triggered!";
    });
    addShortcut("swap_group_16_surface", "Swap Group 16 to Active Monitor", "Meta+Hyper+6", [=]() {
        qDebug(Bi) << "Swap Group 16 to Active Monitor Triggered!";
    });
    addShortcut("swap_group_17_surface", "Swap Group 17 to Active Monitor", "Meta+Hyper+7", [=]() {
        qDebug(Bi) << "Swap Group 17 to Active Monitor Triggered!";
    });
    addShortcut("swap_group_18_surface", "Swap Group 18 to Active Monitor", "Meta+Hyper+8", [=]() {
        qDebug(Bi) << "Swap Group 18 to Active Monitor Triggered!";
    });
    addShortcut("swap_group_19_surface", "Swap Group 19 to Active Monitor", "Meta+Hyper+9", [=]() {
        qDebug(Bi) << "Swap Group 19 to Active Monitor Triggered!";
    });
    addShortcut("swap_group_20_surface", "Swap Group 20 to Active Monitor", "Meta+Hyper+0", [=]() {
        qDebug(Bi) << "Swap Group 20 to Active Monitor Triggered!";
    });

    addShortcut("change_window_group_1", "Send Active Window to Group 1", "Meta+Ctrl+1", [=]() {
        qDebug(Bi) << "Send Active Window to Group 1 Triggered!";
    });
    addShortcut("change_window_group_2", "Send Active Window to Group 2", "Meta+Ctrl+2", [=]() {
        qDebug(Bi) << "Send Active Window to Group 2 Triggered!";
    });
    addShortcut("change_window_group_3", "Send Active Window to Group 3", "Meta+Ctrl+3", [=]() {
        qDebug(Bi) << "Send Active Window to Group 3 Triggered!";
    });
    addShortcut("change_window_group_4", "Send Active Window to Group 4", "Meta+Ctrl+4", [=]() {
        qDebug(Bi) << "Send Active Window to Group 4 Triggered!";
    });
    addShortcut("change_window_group_5", "Send Active Window to Group 5", "Meta+Ctrl+5", [=]() {
        qDebug(Bi) << "Send Active Window to Group 5 Triggered!";
    });
    addShortcut("change_window_group_6", "Send Active Window to Group 6", "Meta+Ctrl+6", [=]() {
        qDebug(Bi) << "Send Active Window to Group 6 Triggered!";
    });
    addShortcut("change_window_group_7", "Send Active Window to Group 7", "Meta+Ctrl+7", [=]() {
        qDebug(Bi) << "Send Active Window to Group 7 Triggered!";
    });
    addShortcut("change_window_group_8", "Send Active Window to Group 8", "Meta+Ctrl+8", [=]() {
        qDebug(Bi) << "Send Active Window to Group 8 Triggered!";
    });
    addShortcut("change_window_group_9", "Send Active Window to Group 9", "Meta+Ctrl+9", [=]() {
        qDebug(Bi) << "Send Active Window to Group 9 Triggered!";
    });
    addShortcut("change_window_group_10", "Send Active Window to Group 10", "Meta+Ctrl+0", [=]() {
        qDebug(Bi) << "Send Active Window to Group 10 Triggered!";
    });
    addShortcut("change_window_group_11", "Send Active Window to Group 11", "Hyper+Ctrl+1", [=]() {
        qDebug(Bi) << "Send Active Window to Group 11 Triggered!";
    });
    addShortcut("change_window_group_12", "Send Active Window to Group 12", "Hyper+Ctrl+2", [=]() {
        qDebug(Bi) << "Send Active Window to Group 12 Triggered!";
    });
    addShortcut("change_window_group_13", "Send Active Window to Group 13", "Hyper+Ctrl+3", [=]() {
        qDebug(Bi) << "Send Active Window to Group 13 Triggered!";
    });
    addShortcut("change_window_group_14", "Send Active Window to Group 14", "Hyper+Ctrl+4", [=]() {
        qDebug(Bi) << "Send Active Window to Group 14 Triggered!";
    });
    addShortcut("change_window_group_15", "Send Active Window to Group 15", "Hyper+Ctrl+5", [=]() {
        qDebug(Bi) << "Send Active Window to Group 15 Triggered!";
    });
    addShortcut("change_window_group_16", "Send Active Window to Group 16", "Hyper+Ctrl+6", [=]() {
        qDebug(Bi) << "Send Active Window to Group 16 Triggered!";
    });
    addShortcut("change_window_group_17", "Send Active Window to Group 17", "Hyper+Ctrl+7", [=]() {
        qDebug(Bi) << "Send Active Window to Group 17 Triggered!";
    });
    addShortcut("change_window_group_18", "Send Active Window to Group 18", "Hyper+Ctrl+8", [=]() {
        qDebug(Bi) << "Send Active Window to Group 18 Triggered!";
    });
    addShortcut("change_window_group_19", "Send Active Window to Group 19", "Hyper+Ctrl+9", [=]() {
        qDebug(Bi) << "Send Active Window to Group 19 Triggered!";
    });
    addShortcut("change_window_group_20", "Send Active Window to Group 20", "Hyper+Ctrl+0", [=]() {
        qDebug(Bi) << "Send Active Window to Group 20 Triggered!";
    });
}

void Controller::loadExistingWindows()
{
    auto clients = m_plasmaApi.workspace().clientList();

    for (auto client : clients) {
        m_engine.addWindow(client);
    }
}

void Controller::registerAction(const Action &data)
{
    auto action = new QAction(this);
    action->setProperty("componentName", QStringLiteral("bismuth"));
    action->setProperty("componentDisplayName", i18n("Window Tiling"));
    action->setObjectName(data.id);
    action->setText(data.description);

    // Register the keybinding as the default. This is needed for KCM to
    // recognize it as such, so that it can properly show whether it is changed
    // from the default.
    KGlobalAccel::self()->setDefaultShortcut(action, data.defaultKeybinding);

    // How this function works:
    // Set the shortcut from the global shortcuts configuration, or set it to
    // the provided value if it is not found in the config
    KGlobalAccel::self()->setShortcut(action, data.defaultKeybinding);

    QObject::connect(action, &QAction::triggered, data.callback);

    m_registeredShortcuts.push_back(action);
};

void Controller::onCurrentSurfaceChanged()
{
    if (m_proxy && !m_config.experimentalBackend()) {
        auto ctl = m_proxy->jsController();
        auto func = ctl.property("onCurrentSurfaceChanged");
        func.callWithInstance(ctl);
    }
}

void Controller::onSurfaceUpdate()
{
    if (m_proxy && !m_config.experimentalBackend()) {
        auto ctl = m_proxy->jsController();
        auto func = ctl.property("onSurfaceUpdate");
        func.callWithInstance(ctl);
    }
}

void Controller::onClientAdded(PlasmaApi::Client client)
{
    if (m_config.experimentalBackend()) {
        m_engine.addWindow(client);
    }
}

void Controller::onClientRemoved(PlasmaApi::Client client)
{
    if (m_config.experimentalBackend()) {
        m_engine.removeWindow(client);
    }
}

void Controller::onClientMaximized(PlasmaApi::Client)
{
}

void Controller::onClientUnmaximized(PlasmaApi::Client)
{
}

void Controller::onClientMinimized(PlasmaApi::Client)
{
}

void Controller::onClientUnminimized(PlasmaApi::Client)
{
}

void Controller::setProxy(TSProxy *proxy)
{
    m_proxy = proxy;
}

Action::Action(const QString &id, const QString &description, const QString &defaultKeybinding, std::function<void()> callback)
{
    this->id = id;
    this->description = description;
    this->defaultKeybinding = {QKeySequence(defaultKeybinding)};
    this->callback = callback;
};

}
