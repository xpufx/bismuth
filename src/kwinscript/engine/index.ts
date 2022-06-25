// SPDX-FileCopyrightText: 2018-2019 Eon S. Jeon <esjeon@hyunmu.am>
// SPDX-FileCopyrightText: 2021 Mikhail Zolotukhin <mail@gikari.com>
//
// SPDX-License-Identifier: MIT

import MonocleLayout from "./layout/monocle_layout";

import LayoutStore from "./layout_store";
import { WindowStore, WindowStoreImpl } from "./window_store";
import { EngineWindow, EngineWindowImpl, WindowState } from "./window";

import { Controller } from "../controller";

import { DriverSurface } from "../driver/surface";

import { Rect, RectDelta } from "../util/rect";
import { overlap, wrapIndex } from "../util/func";
import { Config } from "../config";
import { Log } from "../util/log";
import { WindowsLayout } from "./layout";
import { DriverWindowImpl } from "../driver/window";

export type Direction = "up" | "down" | "left" | "right";
export type CompassDirection = "east" | "west" | "south" | "north";
export type Step = -1 | 1;

/**
 * Maintains tiling context and performs various tiling actions.
 */
export interface Engine {
  /**
   * All the layouts currently available
   */
  layouts: LayoutStore;

  /**
   * All the windows we are interested in
   */
  windows: WindowStore;

  /**
   * Arrange all the windows on the visible surfaces according to the tiling rules
   */
  arrange(screen?: DriverSurface | null): void;

  /**
   * Register the given window to WM.
   */
  manage(window: EngineWindow): void;

  /**
   * Unregister the given window from WM.
   */
  unmanage(window: EngineWindow): void;

  /**
   * Adjust layout based on the change in size of a tile.
   *
   * This operation is completely layout-dependent, and no general implementation is
   * provided.
   *
   * Used when tile is resized using mouse.
   */
  adjustLayout(basis: EngineWindow): void;

  /**
   * Resize the current floating window.
   *
   * @param window a floating window
   */
  resizeFloat(window: EngineWindow, dir: CompassDirection, step: Step): void;

  /**
   * Resize the current tile by adjusting the layout.
   *
   * Used by grow/shrink shortcuts.
   */
  resizeTile(basis: EngineWindow, dir: CompassDirection, step: Step): void;

  /**
   * Resize the given window, by moving border inward or outward.
   *
   * The actual behavior depends on the state of the given window.
   *
   * @param dir which border
   * @param step which direction. 1 means outward, -1 means inward.
   */
  resizeWindow(window: EngineWindow, dir: CompassDirection, step: Step): void;

  /**
   * Re-apply window geometry, computed by layout algorithm.
   *
   * Sometimes applications move or resize windows without user intervention,
   * which is straight against the purpose of tiling WM. This operation
   * move/resize such windows back to where/how they should be.
   */
  enforceSize(window: EngineWindow): void;

  /**
   * @returns the layout we have on the surface of the active window
   */
  currentLayoutOnCurrentSurface(): WindowsLayout;

  /**
   * @returns the active window
   */
  currentWindow(): EngineWindow | null;

  /**
   * Focus next or previous window
   * @param step Direction to step in (1=forward, -1=backward)
   * @param includeHidden Whether to step through (true) or skip over (false) minimized windows
   */
  focusOrder(step: Step, includeHidden: boolean): void;

  /**
   * Focus a neighbor at the given direction.
   */
  focusDir(dir: Direction): void;

  /**
   * Swap the position of the current window with the next or previous window.
   */
  swapOrder(window: EngineWindow, step: Step): void;

  swapDirOrMoveFloat(dir: Direction): void;

  /**
   * Move the active window to the next surface in the given direction
   * @param direction The direction to move in
   */
  moveToSurfaceDir(direction: Direction): void;

  /**
   * Set the current window as the "master".
   *
   * The "master" window is simply the first window in the window list.
   * Some layouts depend on this assumption, and will make such windows more
   * visible than others.
   */
  setMaster(window: EngineWindow): void;

  /**
   * Toggle float mode of window.
   */
  toggleFloat(window: EngineWindow): void;

  /**
   * Change the layout of the current surface to the next.
   */
  cycleLayout(step: Step): void;

  /**
   * Set the layout of the current surface to the specified layout.
   */
  toggleLayout(layoutClassID: string): void;

  /**
   * Minimize all windows on the surface except the given window.
   */
  minimizeOthers(window: EngineWindow): void;

  /**
   * @returns true if the current layout is monocle and the option
   * to minimize other than active windows is enabled
   */
  isLayoutMonocleAndMinimizeRest(): boolean;

  // swapGroupToSurface(groupId: number): void;

  moveWindowToGroup(groupId: number, window?: EngineWindow | null): void;

  moveWindowToSurface(window: EngineWindow, surface: DriverSurface): void;

  // swapSurfaceToScreen(surface: DriverSurface, screen: number): void;
  // swapSurfaceToActiveScreen(surfaceNum: number): void;
  swapGroupToSurface(groupId: number, screen: number): void;
  swapGroupToActiveSurface(groupId: number): void;

  readonly currentSurface: DriverSurface;

  /**
   * Show a popup notification in the center of the screen.
   * @param text the main text of the notification.
   * @param icon an optional name of the icon to display in the pop-up.
   * @param hint an optional string displayed beside the main text.
   */
  showNotification(text: string, icon?: string, hint?: string): void;

  /**
   * Show the notification with the info
   * about the current layout.
   */
  showLayoutNotification(): void;
}

export class EngineImpl implements Engine {
  public layouts: LayoutStore;
  public windows: WindowStore;
  private groupMap: DriverSurface[];

  constructor(
    private controller: Controller,
    private config: Config,
    private log: Log
  ) {
    this.layouts = new LayoutStore(this.config);
    this.windows = new WindowStoreImpl();

    // set initial groupId for each surface to its screen number
    this.groupMap = [];
    // for (let screen = 0; screen < this.controller.screens().length; screen++) {
    //   this.groupMap.push(this.controller.screens()[screen]);
    // }
  }

  public get currentSurface(): DriverSurface {
    return this.controller.currentSurface;
  }

  public adjustLayout(basis: EngineWindow): void {
    if (!basis.surface) {
      return;
    }
    const srf = basis.surface;
    const layout = this.layouts.getCurrentLayout(srf);
    if (layout.adjust) {
      const area = srf.workingArea.gap(
        this.config.screenGapLeft,
        this.config.screenGapRight,
        this.config.screenGapTop,
        this.config.screenGapBottom
      );
      const tiles = this.windows.visibleTiledWindowsOn(srf);
      layout.adjust(area, tiles, basis, basis.geometryDelta);
    }
  }

  public resizeFloat(
    window: EngineWindow,
    dir: CompassDirection,
    step: Step
  ): void {
    if (!window.surface) {
      return;
    }
    const srf = window.surface;

    // TODO: configurable step size?
    const hStepSize = srf.workingArea.width * 0.05;
    const vStepSize = srf.workingArea.height * 0.05;

    let hStep, vStep;
    switch (dir) {
      case "east":
        (hStep = step), (vStep = 0);
        break;
      case "west":
        (hStep = -step), (vStep = 0);
        break;
      case "south":
        (hStep = 0), (vStep = step);
        break;
      case "north":
        (hStep = 0), (vStep = -step);
        break;
    }

    const geometry = window.actualGeometry;
    const width = geometry.width + hStepSize * hStep;
    const height = geometry.height + vStepSize * vStep;

    window.forceSetGeometry(new Rect(geometry.x, geometry.y, width, height));
  }

  public resizeTile(
    basis: EngineWindow,
    dir: CompassDirection,
    step: Step
  ): void {
    if (!basis.surface) {
      return;
    }
    const srf = basis.surface;

    if (dir === "east") {
      const maxX = basis.geometry.maxX;
      const easternNeighbor = this.windows
        .visibleTiledWindowsOn(srf)
        .filter((tile) => tile.geometry.x >= maxX);
      if (easternNeighbor.length === 0) {
        dir = "west";
        step *= -1;
      }
    } else if (dir === "south") {
      const maxY = basis.geometry.maxY;
      const southernNeighbor = this.windows
        .visibleTiledWindowsOn(srf)
        .filter((tile) => tile.geometry.y >= maxY);
      if (southernNeighbor.length === 0) {
        dir = "north";
        step *= -1;
      }
    }

    // TODO: configurable step size?
    const hStepSize = srf.workingArea.width * 0.03;
    const vStepSize = srf.workingArea.height * 0.03;
    let delta: RectDelta;
    switch (dir) {
      case "east":
        delta = new RectDelta(hStepSize * step, 0, 0, 0);
        break;
      case "west":
        delta = new RectDelta(0, hStepSize * step, 0, 0);
        break;
      case "south":
        delta = new RectDelta(0, 0, vStepSize * step, 0);
        break;
      case "north": // Pass through
      default:
        delta = new RectDelta(0, 0, 0, vStepSize * step);
        break;
    }

    const layout = this.layouts.getCurrentLayout(srf);
    if (layout.adjust) {
      const area = srf.workingArea.gap(
        this.config.screenGapLeft,
        this.config.screenGapRight,
        this.config.screenGapTop,
        this.config.screenGapBottom
      );
      layout.adjust(
        area,
        this.windows.visibleTileableWindowsOn(srf),
        basis,
        delta
      );
    }
  }

  public resizeWindow(
    window: EngineWindow,
    dir: CompassDirection,
    step: Step
  ): void {
    const state = window.state;
    if (EngineWindowImpl.isFloatingState(state)) {
      this.resizeFloat(window, dir, step);
    } else if (EngineWindowImpl.isTiledState(state)) {
      this.resizeTile(window, dir, step);
    }
  }

  public arrange(screen?: DriverSurface | null): void {
    /* Try to avoid calling this; use arrangeScreen and commitArrangement on
    specific surfaces instead */

    if (screen === null) {
      return;
    }

    if (!this.controller.currentActivity || !this.controller.currentDesktop) {
      return;
    }

    if (screen) {
      this.arrangeScreen(screen);
      this.commitArrangement(screen);
      return;
    }

    this.log.log("someone called global arrange");

    this.controller
      .screens(this.controller.currentActivity, this.controller.currentDesktop)
      .forEach((surf: DriverSurface) => {
        this.arrangeScreen(surf);
        this.commitArrangement(surf);
      });
  }

  /**
   * Arrange tiles on one screen
   *
   * @param screenSurface screen's surface, on which windows should be arranged
   */
  private arrangeScreen(screenSurface: DriverSurface): void {
    this.log.log(
      `arranging surface: ${screenSurface.screen} group: ${screenSurface.group}`
    );

    const layout = this.layouts.getCurrentLayout(screenSurface);

    const workingArea = screenSurface.workingArea;
    const tilingArea = this.getTilingArea(workingArea, layout);

    const visibleWindows = this.windows.visibleWindowsOn(screenSurface);

    // Set correct window state for new windows
    visibleWindows.forEach((win: EngineWindow) => {
      if (win.state === WindowState.Undecided) {
        win.state = win.shouldFloat ? WindowState.Floating : WindowState.Tiled;
      }
    });

    const tileableWindows =
      this.windows.visibleTileableWindowsOn(screenSurface);

    tileableWindows.forEach((win: EngineWindow) => {
      this.log.log(`tiling group ${win.window.group} ${win}`);
    });

    // Maximize sole tile if enabled or apply the current layout as expected
    if (this.config.maximizeSoleTile && tileableWindows.length === 1) {
      tileableWindows[0].state = WindowState.Maximized;
      tileableWindows[0].geometry = workingArea;
    } else if (tileableWindows.length > 0) {
      layout.apply(this.controller, tileableWindows, tilingArea);
    }

    // If enabled, limit the windows' width
    if (
      this.config.limitTileWidthRatio > 0 &&
      !(layout instanceof MonocleLayout)
    ) {
      const maxWidth = Math.floor(
        workingArea.height * this.config.limitTileWidthRatio
      );
      tileableWindows
        .filter((tile) => tile.tiled && tile.geometry.width > maxWidth)
        .forEach((tile) => {
          const g = tile.geometry;
          tile.geometry = new Rect(
            g.x + Math.floor((g.width - maxWidth) / 2),
            g.y,
            maxWidth,
            g.height
          );
        });
    }

    this.log.log(["arrangeScreen/finished", { screenSurface }]);
  }

  /**
   * Push the arrangement to kwin to commit any changes
   * @param surface Windows on this surface will be committed
   */
  private commitArrangement(surface: DriverSurface): void {
    // Commit window assigned properties
    const visibleWindows = this.windows.visibleWindowsOn(surface);

    visibleWindows.forEach((win: EngineWindow) => {
      this.log.log(`committing: ${win}`);
      visibleWindows.forEach((win: EngineWindow) => win.commit());
    });
  }

  public currentLayoutOnCurrentSurface(): WindowsLayout {
    return this.layouts.getCurrentLayout(this.controller.currentSurface);
  }

  public currentWindow(): EngineWindow | null {
    return this.controller.currentWindow;
  }

  public enforceSize(window: EngineWindow): void {
    if (window.tiled && !window.actualGeometry.equals(window.geometry)) {
      window.commit();
    }
  }

  public manage(window: EngineWindow): void {
    if (!window.shouldIgnore) {
      /* engine#arrange will update the state when required. */
      window.state = WindowState.Undecided;
      if (this.config.newWindowSpawnLocation == "master") {
        this.windows.unshift(window);
      } else if (
        this.controller.currentWindow &&
        this.config.newWindowSpawnLocation == "beforeFocused"
      ) {
        this.windows.push(window);
        this.windows.move(window, this.controller.currentWindow);
      } else if (
        this.controller.currentWindow &&
        this.config.newWindowSpawnLocation == "afterFocused"
      ) {
        this.windows.push(window);
        this.windows.move(window, this.controller.currentWindow, true);
      } else {
        /* newWindowSpawnLocation == "end" or "floating" */
        this.windows.push(window);
      }
      if (!window.surface) {
        return;
      }
      this.arrangeScreen(window.surface);
      this.commitArrangement(window.surface);
    }
  }

  public unmanage(window: EngineWindow): void {
    const surface = window.window.surface;
    this.windows.remove(window);
    if (surface) {
      this.arrange(surface);
    }
  }

  /**
   * Focus next or previous window
   * @param step direction to step in (1 for forward, -1 for back)
   * @param includeHidden whether to switch to or skip minimized windows
   */
  public focusOrder(step: Step, includeHidden = false): void {
    const window = this.controller.currentWindow;
    let windows;

    if (includeHidden) {
      windows = this.windows.allWindowsOn(this.controller.currentSurface);
    } else {
      windows = this.windows.visibleWindowsOn(this.controller.currentSurface);
    }

    if (windows.length === 0) {
      // Nothing to focus
      return;
    }

    /* If no current window, select the first one. */
    if (window === null) {
      this.controller.currentWindow = windows[0];
      return;
    }

    const idx = windows.indexOf(window);
    if (!window || idx < 0) {
      /* This probably shouldn't happen, but just in case... */
      this.controller.currentWindow = windows[0];
      return;
    }

    const num = windows.length;
    const newIndex = (idx + (step % num) + num) % num;

    this.controller.currentWindow = windows[newIndex];
  }

  public focusDir(dir: Direction): void {
    const window = this.controller.currentWindow;

    /* if no current window, select the first window. */
    if (window === null) {
      const tiles = this.windows.visibleWindowsOn(
        this.controller.currentSurface
      );
      if (tiles.length > 0) {
        this.controller.currentWindow = tiles[0];
      }
      return;
    }

    const neighbor = this.config.moveBetweenSurfaces
      ? this.getNeighborByDirection(window.geometry, dir)
      : this.getNeighborByDirection(
          window.geometry,
          dir,
          this.controller.currentSurface
        );

    if (neighbor) {
      this.controller.currentWindow = neighbor;
    }
  }

  public swapOrder(window: EngineWindow, step: Step): void {
    if (!window.surface) {
      return;
    }
    const srf = window.surface;
    const visibles = this.windows.visibleWindowsOn(srf);
    if (visibles.length < 2) {
      return;
    }

    const vsrc = visibles.indexOf(window);
    const vdst = wrapIndex(vsrc + step, visibles.length);
    const dstWin = visibles[vdst];

    this.windows.move(window, dstWin);
  }

  /**
   * Swap the position of the current window with a neighbor at the given direction.
   */
  public swapDirection(dir: Direction): void {
    const window = this.controller.currentWindow;
    if (window === null) {
      /* if no current window, select the first tile. */
      const tiles = this.windows.visibleTiledWindowsOn(
        this.controller.currentSurface
      );
      if (tiles.length > 1) {
        this.controller.currentWindow = tiles[0];
      }
      return;
    }

    const neighbor = this.getNeighborByDirection(window.geometry, dir);
    this.log.log(`found swap neighbor ${neighbor}`);

    if (neighbor?.surface && neighbor.surface.id == window.surface?.id) {
      this.log.log(`swapping with neighbor on same surface ${window.surface}`);

      const iBefore = this.windows
        .visibleWindowsOn(window.surface)
        .indexOf(window);
      this.windows.move(window, neighbor);
      const iAfter = this.windows
        .visibleWindowsOn(window.surface)
        .indexOf(window);
      if (iBefore == iAfter) {
        this.windows.swap(window, neighbor);
      }
      return;
    } else if (!this.config.moveBetweenSurfaces) {
      return;
    }

    const screenCandidates = this.controller
      .screens()
      .filter((surface) => surface.id != window.surface?.id);

    const closestSurface = this.findClosestSurface(
      window,
      dir,
      screenCandidates
    );

    if (neighbor && closestSurface && closestSurface == neighbor.surface) {
      this.log.log(`moving to neighbor on surface ${neighbor.surface}`);

      /* arrange the window into the new layout before picking which tile is
      closest, else we might pick a location that seems sensible now but
      doesn't seem sensible after the layout rearranges with the new window */

      const oldWindowPosition = window.geometry;
      window.window.surface = neighbor.surface;
      this.arrangeScreen(window.window.surface);

      const closestSlot = this.getNeighborByDirection(oldWindowPosition, dir);
      if (!closestSlot) {
        return;
      }

      this.windows.move(window, closestSlot);
    } else if (closestSurface) {
      this.log.log(`moving to empty screen ${closestSurface}`);
      this.controller.moveWindowToSurface(window, closestSurface);
    }
  }

  /**
   * Move the given window towards the given direction by one step.
   * @param window a floating window
   * @param dir which direction
   */
  public moveFloat(window: EngineWindow, dir: Direction): void {
    if (!window.surface) {
      return;
    }
    const srf = window.surface;

    // TODO: configurable step size?
    const hStepSize = srf.workingArea.width * 0.05;
    const vStepSize = srf.workingArea.height * 0.05;

    let hStep, vStep;
    switch (dir) {
      case "up":
        (hStep = 0), (vStep = -1);
        break;
      case "down":
        (hStep = 0), (vStep = 1);
        break;
      case "left":
        (hStep = -1), (vStep = 0);
        break;
      case "right":
        (hStep = 1), (vStep = 0);
        break;
    }

    const geometry = window.actualGeometry;
    const x = geometry.x + hStepSize * hStep;
    const y = geometry.y + vStepSize * vStep;

    window.forceSetGeometry(new Rect(x, y, geometry.width, geometry.height));
  }

  public swapDirOrMoveFloat(dir: Direction): void {
    const window = this.controller.currentWindow;
    if (!window) {
      return;
    }

    const state = window.state;
    if (EngineWindowImpl.isFloatingState(state)) {
      this.moveFloat(window, dir);
    } else if (EngineWindowImpl.isTiledState(state)) {
      this.swapDirection(dir);
    }
  }

  public findClosestSurface(
    window: EngineWindow,
    dir: Direction,
    screens: DriverSurface[]
  ): DriverSurface | null {
    const screenCandidates = [];
    for (const surf of screens) {
      switch (dir) {
        case "up":
          if (
            surf.workingArea.center[1] < window.geometry.center[1] &&
            overlap(
              surf.workingArea.x,
              surf.workingArea.maxX,
              window.geometry.x,
              window.geometry.maxX
            )
          ) {
            screenCandidates.push(surf);
          }
          break;
        case "down":
          if (
            surf.workingArea.center[1] > window.geometry.center[1] &&
            overlap(
              surf.workingArea.x,
              surf.workingArea.maxX,
              window.geometry.x,
              window.geometry.maxX
            )
          ) {
            screenCandidates.push(surf);
          }
          break;
        case "left":
          if (
            surf.workingArea.center[0] < window.geometry.center[0] &&
            overlap(
              surf.workingArea.y,
              surf.workingArea.maxY,
              window.geometry.y,
              window.geometry.maxY
            )
          ) {
            screenCandidates.push(surf);
          }
          break;
        case "right":
          if (
            surf.workingArea.center[0] > window.geometry.center[0] &&
            overlap(
              surf.workingArea.y,
              surf.workingArea.maxY,
              window.geometry.y,
              window.geometry.maxY
            )
          ) {
            screenCandidates.push(surf);
          }
      }
    }

    let closestDistance = Infinity;
    let closestScreen: DriverSurface | null = null;
    for (const surf of screenCandidates) {
      const distance = Math.hypot(
        surf.workingArea.center[0] - window.geometry.center[0],
        surf.workingArea.center[1] - window.geometry.center[1]
      );
      if (distance < closestDistance) {
        closestDistance = distance;
        closestScreen = surf;
      }
    }

    return closestScreen;
  }

  public moveToSurfaceDir(dir: Direction): void {
    const win = this.controller.currentWindow;
    if (!win) {
      return;
    }

    const screenCandidates = this.controller
      .screens()
      .filter((surf) => surf.id != win.surface?.id);

    const closestScreen = this.findClosestSurface(win, dir, screenCandidates);

    if (!closestScreen) {
      return;
    }

    this.controller.moveWindowToSurface(win, closestScreen);
  }

  public toggleFloat(window: EngineWindow): void {
    window.state = !window.tileable ? WindowState.Tiled : WindowState.Floating;
  }

  public setMaster(window: EngineWindow): void {
    this.windows.putWindowToMaster(window);
    if (window.window.surface) {
      this.arrange(window.window.surface);
    }
  }

  public cycleLayout(step: Step): void {
    const layout = this.layouts.cycleLayout(
      this.controller.currentSurface,
      step
    );
    if (layout) {
      this.showLayoutNotification();

      // Minimize inactive windows if Monocle and config.monocleMinimizeRest
      if (
        this.isLayoutMonocleAndMinimizeRest() &&
        this.controller.currentWindow
      ) {
        this.minimizeOthers(this.controller.currentWindow);
      }
    }
  }

  public toggleLayout(layoutClassID: string): void {
    const layout = this.layouts.toggleLayout(
      this.controller.currentSurface,
      layoutClassID
    );
    if (layout) {
      this.showLayoutNotification();

      // Minimize inactive windows if Monocle and config.monocleMinimizeRest
      if (
        this.isLayoutMonocleAndMinimizeRest() &&
        this.controller.currentWindow
      ) {
        this.minimizeOthers(this.controller.currentWindow);
      }
    }
  }

  public minimizeOthers(window: EngineWindow): void {
    if (!window.surface) {
      return;
    }
    for (const tile of this.windows.visibleTiledWindowsOn(window.surface)) {
      if (
        tile.screen == window.screen &&
        tile.id !== window.id &&
        this.windows.visibleTiledWindowsOn(window.surface).includes(window)
      ) {
        tile.minimized = true;
      } else {
        tile.minimized = false;
      }
    }
  }

  public isLayoutMonocleAndMinimizeRest(): boolean {
    return (
      this.currentLayoutOnCurrentSurface() instanceof MonocleLayout &&
      this.config.monocleMinimizeRest
    );
  }

  /**
   * Find windows in a given direction from a basis which have at least
   * partial overlap in the perpendicular axis with the basis
   * @param basis origin geometry from which to search
   * @param dir search in this direction from basis
   * @param surface if specified, restrict search to this surface
   * @returns a list of windows on surface located dir from basis
   */
  private getNeighborCandidates(
    basis: Rect,
    dir: Direction,
    surface?: DriverSurface
  ): EngineWindow[] {
    const visibleWindowsOnCurrentSurface = surface
      ? this.windows.visibleTiledWindowsOn(surface)
      : this.windows.visibleTiledWindows(
          this.controller.currentActivity,
          this.controller.currentDesktop
        );

    /* Flipping all inputs' signs allows for the same logic to find closest
     windows in either direction */
    const sign = dir === "down" || dir === "right" ? 1 : -1;

    if (dir === "up" || dir === "down") {
      return visibleWindowsOnCurrentSurface.filter(
        (window): boolean =>
          window.geometry.y * sign > basis.y * sign &&
          overlap(basis.x, basis.maxX, window.geometry.x, window.geometry.maxX)
      );
    } else {
      return visibleWindowsOnCurrentSurface.filter(
        (window): boolean =>
          window.geometry.x * sign > basis.x * sign &&
          overlap(basis.y, basis.maxY, window.geometry.y, window.geometry.maxY)
      );
    }
  }

  private getClosestRelativWindowCorner(
    geometries: Rect[],
    dir: Direction
  ): number {
    return geometries.reduce(
      (prevValue, geometry): number => {
        switch (dir) {
          case "up":
            return Math.max(geometry.maxY, prevValue);
          case "down":
            return Math.min(geometry.y, prevValue);
          case "left":
            return Math.max(geometry.maxX, prevValue);
          case "right":
            return Math.min(geometry.x, prevValue);
        }
      },
      dir === "up" || dir === "left" ? 0 : Infinity
    );
  }

  private getClosestRelativeWindow(
    windowArray: EngineWindow[],
    dir: Direction,
    closestPoint: number
  ): EngineWindow[] {
    return windowArray.filter((window): boolean => {
      // adjust closestPoint for potential misalignment of tiled windows
      switch (dir) {
        case "up":
          return window.geometry.maxY > closestPoint - 5;
        case "down":
          return window.geometry.y < closestPoint + 5;
        case "left":
          return window.geometry.maxX > closestPoint - 5;
        case "right":
          return window.geometry.x < closestPoint + 5;
      }
    });
  }

  private getNeighborByDirection(
    basis: Rect,
    dir: Direction,
    surface?: DriverSurface
  ): EngineWindow | null {
    const neighborCandidates = surface
      ? this.getNeighborCandidates(basis, dir, surface)
      : this.getNeighborCandidates(basis, dir);

    if (neighborCandidates.length === 0) {
      return null;
    }

    const closestWindowCorner = this.getClosestRelativWindowCorner(
      neighborCandidates.map((window) => window.geometry),
      dir
    );

    const closestWindows = this.getClosestRelativeWindow(
      neighborCandidates,
      dir,
      closestWindowCorner
    );

    // Return the most recently used window
    return closestWindows.sort((a, b) => b.timestamp - a.timestamp)[0];
  }

  // public swapGroupToSurface(groupId: number): void {
  //   this.controller.swapGroupToSurface(groupId);
  // }

  public moveWindowToGroup(
    groupId: number,
    window?: EngineWindow | null
  ): void {
    if (!window) {
      window = this.controller.currentWindow;
    }
    if (!window) {
      return;
    }

    this.controller.showNotification(
      `Move window to group`,
      undefined,
      `${groupId}`
    );

    const oldSurf = this.controller.moveWindowToGroup(groupId, window);

    if (oldSurf) {
      this.arrange(oldSurf);
    }

    if (!window.window.hidden && window.window.surface) {
      this.arrange(window.window.surface);
    }
  }

  public swapGroupToSurface(groupId: number, screen: number): void {
    let oldSurf = null;
    for (const surf of this.controller.screens()) {
      if (surf.group == groupId) {
        oldSurf = surf;
      }
    }

    this.log.log(
      `swapping group ${groupId} from screen ${oldSurf?.screen} to ${screen}`
    );

    this.controller.swapGroupToSurface(groupId, screen);

    this.log.log(`do arrange for screen ${this.controller.screens()[screen]}`);

    this.arrange(this.controller.screens()[screen]);

    if (oldSurf) {
      oldSurf = this.controller.screens()[oldSurf.screen];
      this.log.log(
        `also do arrange for screen ${oldSurf.screen} group ${oldSurf.group}`
      );
      this.arrange(oldSurf);
    }
  }

  public swapGroupToActiveSurface(groupId: number): void {
    const activeDesktop = this.controller.currentDesktop;
    const activeScreen = this.controller.currentSurface.screen;
    this.controller.showNotification(`Recall group`, undefined, `${groupId}`);

    this.swapGroupToSurface(groupId, activeScreen);
    // set focus to first window in the new group
    this.controller.currentWindow = this.windows.visibleTiledWindowsOn(
      this.controller.screens()[activeScreen]
    )[0];
  }

  public moveWindowToSurface(
    window: EngineWindow,
    surface: DriverSurface
  ): void {
    // this.driver.moveWindowToSurface(window, surface);
    this.log.log(
      `moving from group ${window.window.group} to screen ${surface.screen}`
    );
    this.controller.showNotification(`Move window to screen ${surface.screen}`);
    // window.surface = surface;
    this.arrangeScreen(surface);
    this.commitArrangement(surface);
  }

  // public swapSurfaceToScreen(surface: DriverSurface, screen: number): void {
  //   // this.controller.screens()[screen].
  //   // surface.screen = screen;

  //   const surfaceA = surface;
  //   const surfaceB = this.controller.screens()[screen];

  //   const windowsA = this.windows.visibleTiledWindowsOn(surfaceA);
  //   const windowsB = this.windows.visibleTiledWindowsOn(surfaceB);

  //   for (const win of windowsA) {
  //     win.surface = surfaceB;
  //   }

  //   for (const win of windowsB) {
  //     win.surface = surfaceA;
  //   }

  //   this.arrange(surfaceA);
  //   this.arrange(surfaceB);
  // }

  // public swapSurfaceToActiveScreen(surfaceNum: number): void {
  //   this.log.log(
  //     `swapping surface ${surfaceNum} to screen ${this.controller.currentSurface.screen}`
  //   );

  //   this.swapSurfaceToScreen(this.controller.currentSurface, surfaceNum);
  // }

  public showNotification(text: string, icon?: string, hint?: string): void {
    this.controller.showNotification(text, icon, hint);
  }

  public showLayoutNotification(): void {
    const currentLayout = this.currentLayoutOnCurrentSurface();
    this.controller.showNotification(
      currentLayout.name,
      currentLayout.icon,
      currentLayout.hint
    );
  }

  /**
   * Returns the tiling area for the given working area and the windows layout.
   *
   * Tiling area is the area we are allowed to put windows in, not counting the inner gaps
   * between them. I.e. working are without gaps.
   *
   * @param workingArea area in which we are allowed to work. @see DriverSurface#workingArea
   * @param layout windows layout used
   */
  private getTilingArea(workingArea: Rect, layout: WindowsLayout): Rect {
    if (this.config.monocleMaximize && layout instanceof MonocleLayout) {
      return workingArea;
    } else {
      return workingArea.gap(
        this.config.screenGapLeft,
        this.config.screenGapRight,
        this.config.screenGapTop,
        this.config.screenGapBottom
      );
    }
  }
}
