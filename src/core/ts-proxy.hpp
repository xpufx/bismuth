// SPDX-FileCopyrightText: 2022 Mikhail Zolotukhin <mail@gikari.com>
// SPDX-License-Identifier: MIT

#pragma once

#include <QJSValue>
#include <QObject>
#include <QQmlEngine>

#include "config.hpp"
#include "controller.hpp"
#include "plasma-api/api.hpp"

/**
 * Proxy object for the legacy TS backend.
 */
class TSProxy : public QObject
{
    Q_OBJECT
public:
    TSProxy(QQmlEngine *, Bismuth::Controller &, PlasmaApi::Api &, Bismuth::Config &);

    /**
     * Returns the config usable in the legacy TypeScript logic
     */
    Q_INVOKABLE QJSValue jsConfig();

    Q_INVOKABLE QString getWindowState(const QString);
    Q_INVOKABLE void putWindowState(const QString, const QString);

    Q_INVOKABLE QString getLayoutState(const QString);
    Q_INVOKABLE void putLayoutState(const QString, const QString);

    Q_INVOKABLE QString getWindowList();
    Q_INVOKABLE void putWindowList(const QString);

    Q_INVOKABLE int getSurfaceGroup(int desktop, int screen);
    Q_INVOKABLE void setSurfaceGroup(int desktop, int screen, int groupID);

    /**
     * Returns the workspace instance
     */
    Q_INVOKABLE QJSValue workspace();

    /**
     * Register the actions from the legacy backend
     * @param tsaction
     */
    Q_INVOKABLE void registerShortcut(const QJSValue &);

    /**
     * Log the value to the default logging category
     */
    Q_INVOKABLE void log(const QJSValue &);

    Q_INVOKABLE void setJsController(const QJSValue &);
    QJSValue jsController();

private:
    QQmlEngine *m_engine;
    Bismuth::Config &m_config;
    Bismuth::Controller &m_controller;
    PlasmaApi::Api &m_plasmaApi;
    QJSValue m_jsController;
};
