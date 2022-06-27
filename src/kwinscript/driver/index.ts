// SPDX-FileCopyrightText: 2018-2019 Eon S. Jeon <esjeon@hyunmu.am>
// SPDX-FileCopyrightText: 2021 Mikhail Zolotukhin <mail@gikari.com>
//
// SPDX-License-Identifier: MIT

import { DriverSurface } from "./surface";
import { DriverSurfaceImpl } from "./surface";
import { DriverWindow, DriverWindowImpl } from "./window";

import { Controller } from "../controller";

import { EngineWindow, EngineWindowImpl } from "../engine/window";

import { WindowState } from "../engine/window";

import { Config } from "../config";
import { Log } from "../util/log";
import { TSProxy } from "../extern/proxy";

/**
 * Provides convenient interface to KWin functions.
 * Hides all the bad and ugly things current KWin has.
 */
export interface Driver {
  /**
   * All surfaces/screens possessed by KWin for the given activity and desktop
   */
  screens(activity: string, desktop: number): DriverSurface[];

  /**
   * The currently active surface
   */
  currentSurface: DriverSurface;

  /**
   * The currently active activity
   */
  readonly currentActivity: string;

  /**
   * The currently active desktop
   */
  readonly currentDesktop: number;

  /**
   * Currently active (i.e. focused) window
   */
  currentWindow: EngineWindow | null;

  /**
   * Show a popup notification in the center of the screen.
   * @param text the main text of the notification.
   * @param icon an optional name of the icon to display in the pop-up.
   * @param hint an optional string displayed beside the main text.
   */
  showNotification(
    text: string,
    icon?: string,
    hint?: string,
    screen?: number
  ): void;

  onCurrentDesktopChanged(): void;

  onNumberDesktopsChanged(oldNumDesktops: number): void;

  /**
   * Bind script to the various KWin events
   */
  bindEvents(): void;

  /**
   * Manage the windows, that were active before script loading
   */
  manageWindows(): void;

  moveWindowToGroup(
    groupId: number,
    window?: EngineWindow
  ): DriverSurface | null;

  swapGroupToSurface(groupId: number, screen: number): void;

  /**
   * Destroy all callbacks and other non-GC resources
   */
  drop(): void;

  /**
   * Move window to a different surface. This does not trigger re-tiling.
   * @param window the window to move to @param surface
   * @param surface the surface to move @param window to
   */
  // moveWindowToSurface(window: EngineWindow, surface: DriverSurface): void;
  // swapSurfaceToScreen(surfaceNum: number, screen: number): void;
}

export class DriverImpl implements Driver {
  private groupMap: { [key: number]: number };
  private groupMapSurface: { [desktop: string]: { [screen: string]: number } };
  public get currentSurface(): DriverSurface {
    // this.log.log(
    //   `for ${this.proxy.workspace().activeScreen} making ${
    //     this.groupMap[this.proxy.workspace().activeScreen]
    //   }`
    // );
    const desktop = this.proxy.workspace().currentDesktop;
    const screen = this.proxy.workspace().activeScreen;
    return new DriverSurfaceImpl(
      screen,
      this.proxy.workspace().currentActivity,
      desktop,
      this.groupMapSurface[desktop][screen],
      this.qml.activityInfo,
      this.config,
      this.proxy,
      this.log
    );
  }

  public set currentSurface(value: DriverSurface) {
    const kwinSurface = value as DriverSurfaceImpl;

    /* NOTE: only supports switching desktops */
    // TODO: focusing window on other screen?
    // TODO: find a way to change activity

    if (this.proxy.workspace().currentDesktop !== kwinSurface.desktop) {
      this.proxy.workspace().currentDesktop = kwinSurface.desktop;
    }
  }

  public get currentActivity(): string {
    return this.kwinApi.workspace.currentActivity;
  }

  public get currentDesktop(): number {
    return this.kwinApi.workspace.currentDesktop;
  }

  public get currentWindow(): EngineWindow | null {
    const client = this.kwinApi.workspace.activeClient;
    return client ? this.windowMap.get(client) : null;
  }

  public set currentWindow(window: EngineWindow | null) {
    if (window !== null) {
      this.kwinApi.workspace.activeClient = (
        window.window as DriverWindowImpl
      ).client;
    }
  }

  // public moveWindowToSurface(win: EngineWindow, surf: DriverSurface): void {
  //   win.window.surface = surf;
  // }

  // public swapSurfaceToScreen(surfaceNum: number, screen: number): void {
  //   this.log.log(`swapping surface ${surfaceNum} to screen ${screen}`);

  //   this.controller.screens()[surfaceNum];
  //   this.controller
  // }

  public screens(activity: string, desktop: number): DriverSurface[] {
    const screensArr = [];
    // for (let screen = 0; screen < this.proxy.workspace().numScreens; screen++) {
    for (let screen = 0; screen < this.proxy.workspace().numScreens; screen++) {
      // this.log.log(`for ${screen} making ${this.groupMap[screen]}`);
      screensArr.push(
        new DriverSurfaceImpl(
          screen,
          activity,
          desktop,
          this.groupMapSurface[desktop][screen],
          this.qml.activityInfo,
          this.config,
          this.proxy,
          this.log
        )
      );
    }
    return screensArr;
  }

  private controller: Controller;
  private windowMap: WrapperMap<KWin.Client, EngineWindow>;
  private entered: boolean;

  private qml: Bismuth.Qml.Main;
  private kwinApi: KWin.Api;

  private registeredConnections: SignalCallbackPair[];

  /**
   * @param qmlObjects objects from QML gui. Required for the interaction with QML, as we cannot access globals.
   * @param kwinApi KWin scripting API. Required for interaction with KWin, as we cannot access globals.
   * @param config Bismuth configuration. If none is provided, the configuration is read from KConfig (in most cases from config file).
   */
  constructor(
    qmlObjects: Bismuth.Qml.Main,
    kwinApi: KWin.Api,
    controller: Controller,
    private config: Config,
    private log: Log,
    private proxy: TSProxy
  ) {
    this.registeredConnections = [];

    this.groupMap = {};
    this.groupMapSurface = {};

    if (this.proxy.workspace().desktops < 2) {
      this.proxy.workspace().desktops++;
    }
    const numDesktops = this.proxy.workspace().desktops;

    // const customScreenOrder = [1, 3, 2, 0, 4, 5, 6, 7, 8, 9];
    const customScreenOrder = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

    const numScreens = this.proxy.workspace().numScreens;
    let groupId = 1;
    for (let desktop = 1; desktop <= numDesktops; desktop++) {
      this.groupMapSurface[desktop] = {};
      for (let screen = 0; screen < numScreens; screen++) {
        this.groupMapSurface[desktop][customScreenOrder[screen]] = groupId++;
      }

      // // custom group mapping for misordered screens
      // this.groupMapSurface[desktop][1] = 1 + (desktop - 1) * 10;
      // this.groupMapSurface[desktop][3] = 2 + (desktop - 1) * 10;
      // this.groupMapSurface[desktop][2] = 3 + (desktop - 1) * 10;
      // this.groupMapSurface[desktop][0] = 4 + (desktop - 1) * 10;
      // this.groupMapSurface[desktop][4] = 5 + (desktop - 1) * 10;
    }

    // // set initial groupId for each surface to its screen number
    // for (let screen = 0; screen < this.proxy.workspace().numScreens; screen++) {
    //   this.groupMapSurface[screen] = screen + 1; // start groups at 1
    // }

    // TODO: find a better way to to this
    if (this.config.preventMinimize && this.config.monocleMinimizeRest) {
      log.log("preventMinimize is disabled because of monocleMinimizeRest");
      this.config.preventMinimize = false;
    }

    this.controller = controller;
    this.windowMap = new WrapperMap(
      (client: KWin.Client) => DriverWindowImpl.generateID(client),
      (client: KWin.Client) => {
        const group = this.groupMap[client.windowId];
        // let group = this.groupMapSurface[client.screen];
        // if (this.groupMap[client.windowId]) {
        //   group = this.groupMap[client.windowId];
        // } else {
        //   this.log.log(`setting client ${client.windowId} to group ${group}`);
        //   this.groupMap[client.windowId] = group;
        // }
        const win = new EngineWindowImpl(
          new DriverWindowImpl(
            client,
            this.qml,
            this.config,
            this.log,
            this.proxy,
            // group
            this.groupMap[client.windowId]
          ),
          this.config,
          this.log
        );
        if (!win.shouldIgnore) {
          for (const surf of controller.screens()) {
            if (surf.group == win.window.group) {
              win.window.hidden = false;
              return win;
            }
          }
          win.window.hidden = true;
        }
        return win;
      }
    );
    this.entered = false;
    this.qml = qmlObjects;
    this.kwinApi = kwinApi;
  }

  public bindEvents(): void {
    const onClientAdded = (client: KWin.Client): void => {
      this.log.log(`Client added to screen ${client.screen}: ${client}`);

      const desktop = this.proxy.workspace().currentDesktop;
      const group = this.groupMapSurface[desktop][client.screen];

      this.log.log(
        `initially setting client 0x${client.windowId.toString(
          16
        )} to group ${group}`
      );

      this.groupMap[client.windowId] = group;
      const window = this.windowMap.add(client);

      this.controller.onWindowAdded(window);

      if (window.state === WindowState.Unmanaged) {
        this.log.log(
          `Window becomes unmanaged and gets removed :( The client was ${client}`
        );
        this.windowMap.remove(client);
        delete this.groupMap[client.windowId];
      } else {
        this.log.log(`Client is ok, can manage. Bind events now...`);
        this.bindWindowEvents(window, client);
      }
    };

    const onClientRemoved = (client: KWin.Client): void => {
      const window = this.windowMap.get(client);
      if (window) {
        this.controller.onWindowRemoved(window);
        this.windowMap.remove(client);
        delete this.groupMap[client.windowId];
      }
    };

    const onClientMaximizeSet = (
      client: KWin.Client,
      h: boolean,
      v: boolean
    ): void => {
      // const maximized = h === true && v === true;
      // const window = this.windowMap.get(client);
      // if (window) {
      //   (window.window as DriverWindowImpl).maximized = maximized;
      //   this.controller.onWindowMaximizeChanged(window, maximized);
      // }
    };

    const onClientMinimized = (client: KWin.Client): void => {
      if (this.config.preventMinimize) {
        client.minimized = false;
        this.kwinApi.workspace.activeClient = client;
      } else {
        this.controller.onWindowChanged(
          this.windowMap.get(client),
          "minimized"
        );
      }
    };

    const onClientUnminimized = (client: KWin.Client): void =>
      this.controller.onWindowChanged(
        this.windowMap.get(client),
        "unminimized"
      );

    this.connect(this.kwinApi.workspace.currentActivityChanged, () =>
      this.controller.onCurrentActivityChanged()
    );

    this.connect(this.kwinApi.workspace.currentDesktopChanged, () =>
      this.controller.onCurrentDesktopChanged()
    );

    this.connect(this.kwinApi.workspace.numberDesktopsChanged, (num: number) =>
      this.onNumberDesktopsChanged(num)
    );

    this.connect(this.kwinApi.workspace.clientAdded, onClientAdded);
    this.connect(this.kwinApi.workspace.clientRemoved, onClientRemoved);
    this.connect(this.kwinApi.workspace.clientMaximizeSet, onClientMaximizeSet);
    this.connect(this.kwinApi.workspace.clientMinimized, onClientMinimized);
    this.connect(this.kwinApi.workspace.clientUnminimized, onClientUnminimized);
  }

  public manageWindows(): void {
    const clients = this.kwinApi.workspace.clientList();
    // TODO: provide interface for using the "for of" cycle
    for (let i = 0; i < clients.length; i++) {
      this.manageWindow(clients[i]);
    }
  }

  /**
   * Manage window with the particular KWin clientship
   * @param client window client object specified by KWin
   */
  private manageWindow(client: KWin.Client): void {
    const desktop = this.proxy.workspace().currentDesktop;
    const group = this.groupMapSurface[desktop][client.screen];

    this.log.log(
      `initially setting client ${client.windowId} to group ${group}`
    );

    // Add window to our window map
    this.groupMap[client.windowId] = group;
    const window = this.windowMap.add(client);

    if (window.shouldIgnore) {
      this.windowMap.remove(client);
      delete this.groupMap[client.windowId];
      return;
    }

    this.bindWindowEvents(window, client);

    this.controller.manageWindow(window);
  }

  public moveWindowToGroup(
    groupId: number,
    window?: EngineWindow | null
  ): DriverSurface | null {
    if (!window) {
      window = this.controller.currentWindow;
    }
    if (!window) {
      return null;
    }

    const windowImpl = window.window as DriverWindowImpl;
    const oldGroup = this.groupMap[windowImpl.client.windowId];
    let oldSurf = null;
    for (const surf of this.controller.screens()) {
      if (surf.group == oldGroup) {
        oldSurf = surf;
        break;
      }
    }

    this.log.log(
      `moving window from group ${oldGroup} to group ${groupId} ${window}`
    );

    this.groupMap[(window.window as DriverWindowImpl).client.windowId] =
      groupId;

    for (const surf of this.controller.screens()) {
      if (
        this.groupMapSurface[this.proxy.workspace().currentDesktop][
          surf.screen
        ] == groupId
      ) {
        this.log.log(`showing window on surface ${surf.screen}`);

        window.surface = surf;
        // this.controller.moveWindowToSurface(window, surf);

        window.window.hidden = false;
        return oldSurf ? this.controller.screens()[oldSurf.screen] : null;
      }
    }

    window.window.group = groupId;
    window.window.hidden = true;

    return oldSurf ? this.controller.screens()[oldSurf.screen] : null;

    // this.moveWindowToSurface(window, this.controller.screens()[groupId]);

    // if (window.group != groupId) {
    //   window.group = groupId;
    //   // this.arrangeScreen(window.surface);
    //   // this.commitArrangement(window.surface);
    //   this.arrange();
    // }
  }

  public swapGroupToSurface(groupId: number, screen: number): void {
    const currentDesktop = this.proxy.workspace().currentDesktop;
    const swapOutGroup = this.groupMapSurface[currentDesktop][screen];

    // find if a surface is already showing this group and needs to be swapped
    for (const surf of this.controller.screens()) {
      if (this.groupMapSurface[currentDesktop][surf.screen] == groupId) {
        this.log.log(
          `swapping screen ${screen} group ${swapOutGroup} with screen ${surf.screen} group ${groupId}`
        );
        this.groupMapSurface[currentDesktop][screen] = -1;

        this.controller.swapGroupToSurface(swapOutGroup, surf.screen);
        // this.groupMapSurface[surf.screen] = this.groupMapSurface[screen];
        break;
      }
    }

    // otherwise just map the group to the surface

    this.log.log(`setting screen ${screen} to group ${groupId}`);
    this.groupMapSurface[currentDesktop][screen] = groupId;

    // this.controller.screens()[screen].group = groupId;
  }

  public showNotification(
    text: string,
    icon?: string,
    hint?: string,
    screen?: number
  ): void {
    switch (screen) {
      case 0:
        this.qml.popupDialog0.show(text, icon, hint, screen);
        break;
      case 1:
        this.qml.popupDialog1.show(text, icon, hint, screen);
        break;
      case 2:
        this.qml.popupDialog2.show(text, icon, hint, screen);
        break;
      case 3:
        this.qml.popupDialog3.show(text, icon, hint, screen);
        break;
      case 4:
        this.qml.popupDialog4.show(text, icon, hint, screen);
        break;
    }
  }

  public onCurrentDesktopChanged(): void {
    // const desktop = this.currentDesktop;
    // for (const surf of this.controller.screens()) {
    //   this.swapGroupToSurface(
    //     this.groupMapSurface[desktop][surf.screen],
    //     surf.screen
    //   );
    // }
  }

  public onNumberDesktopsChanged(oldNumDesktops: number): void {
    this.log.log(
      `onNumberDesktopsChanged from ${oldNumDesktops} to ${
        this.proxy.workspace().desktops
      }`
    );
    if (this.proxy.workspace().desktops < 2) {
      this.log.log("Too few desktops! Adding one desktop.");
      this.proxy.workspace().desktops++;
    }
  }

  public drop(): void {
    this.log.log(`Dropping all registered callbacks... Goodbye.`);
    for (const pair of this.registeredConnections) {
      try {
        pair.signal.disconnect(pair.callback);
      } catch (e: any) {
        // Error is thrown, when the object is already deleted,
        // ignore it then and delete other callbacks
        this.log.log(`Callback was already deleted. Ignoring it.`);
      }
    }
  }

  /**
   * Binds callback to the signal with re-entry prevention.
   * Also keeps track of all connections, so that they con be
   * destroyed at script termination via Driver#drop.
   */
  private connect(signal: QSignal, handler: (..._: any[]) => void): void {
    const unboundCallback = (...args: any[]): void => {
      this.enter(() => handler.apply(this, args));
    };

    const pair = {
      signal: signal,
      callback: unboundCallback,
    };

    this.registeredConnections.push(pair);

    signal.connect(pair.callback);
  }

  /**
   * Run the given function in a protected(?) context to prevent nested event
   * handling.
   *
   * KWin emits signals as soon as window states are changed, even when
   * those states are modified by the script. This causes multiple re-entry
   * during event handling, resulting in performance degradation and harder
   * debugging.
   */
  private enter(callback: () => void): void {
    if (this.entered) {
      return;
    }

    this.entered = true;
    try {
      callback();
    } catch (e: any) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
      this.log.log(`Oops! ${e.name}: ${e.message}. `);
    } finally {
      this.entered = false;
    }
  }

  private bindWindowEvents(window: EngineWindow, client: KWin.Client): void {
    let moving = false;
    let resizing = false;

    this.connect(client.moveResizedChanged, () => {
      this.log.log([
        "moveResizedChanged",
        { window, move: client.move, resize: client.resize },
      ]);
      if (moving !== client.move) {
        moving = client.move;
        if (moving) {
          this.controller.onWindowMoveStart(window);
        } else {
          this.controller.onWindowMoveOver(window);
        }
      }
      if (resizing !== client.resize) {
        resizing = client.resize;
        if (resizing) {
          this.controller.onWindowResizeStart(window);
        } else {
          this.controller.onWindowResizeOver(window);
        }
      }
    });

    this.connect(client.frameGeometryChanged, () => {
      this.log.log(`frameGeometryChanged`);
      if (moving || client.move) {
        this.controller.onWindowMove(window);
      } else if (resizing || client.resize) {
        this.controller.onWindowResize(window);
      } else {
        if (!window.actualGeometry.equals(window.geometry)) {
          this.controller.onWindowGeometryChanged(window);
        }
      }
    });

    this.connect(client.activeChanged, () => {
      if (client.active) {
        this.controller.onWindowFocused(window);
      }
    });

    this.connect(client.screenChanged, () => {
      for (const surf of this.controller.screens()) {
        if ((surf as DriverSurfaceImpl).screen == client.screen) {
          window.surface = surf;
          break;
        }
      }
      this.controller.onWindowScreenChanged(window);
    });

    this.connect(client.activitiesChanged, () =>
      this.controller.onWindowChanged(
        window,
        "activity=" + client.activities.join(",")
      )
    );

    this.connect(client.desktopChanged, () => {
      // ignore hijacked desktop ids
      if (client.desktop == -1 || client.desktop == 3) {
        this.log.log(`ignoring desktop ${client.desktop}`);
        return;
      }
      this.log.log(`kwin tried to move window to desktop ${client.desktop}`);

      // client.desktop = this.currentDesktop;
      // this.controller.onWindowDesktopChanged(window);
    });

    this.connect(client.shadeChanged, () => {
      this.controller.onWindowShadeChanged(window);
    });

    this.connect(
      client.clientMaximizedStateChanged,
      (win: KWin.Client, h: boolean, v: boolean) => {
        this.log.log(`clientMaximizedStateChanged ${h} ${v}`);
        this.controller.onWindowMaximizeChanged(window, h || v);
      }
    );
  }
}

interface SignalCallbackPair {
  signal: QSignal;
  callback: (...args: any[]) => void;
}

/**
 * Wrapper map type.
 */
class WrapperMap<F, T> {
  private items: { [key: string]: T };

  constructor(
    public readonly hasher: (item: F) => string,
    public readonly wrapper: (item: F) => T
  ) {
    this.items = {};
  }

  public add(item: F): T {
    const key = this.hasher(item);

    if (this.items[key] !== undefined) {
      throw "WrapperMap: the key [" + key + "] already exists!";
    }

    const wrapped = this.wrapper(item);
    this.items[key] = wrapped;
    return wrapped;
  }

  public get(item: F): T | null {
    const key = this.hasher(item);
    return this.items[key] || null;
  }

  public getByKey(key: string): T | null {
    return this.items[key] || null;
  }

  public remove(item: F): boolean {
    const key = this.hasher(item);
    return delete this.items[key];
  }
}
