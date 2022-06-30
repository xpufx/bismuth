// SPDX-FileCopyrightText: 2018-2019 Eon S. Jeon <esjeon@hyunmu.am>
// SPDX-FileCopyrightText: 2021 Mikhail Zolotukhin <mail@gikari.com>
//
// SPDX-License-Identifier: MIT

import { Config } from "../config";
import { TSProxy } from "../extern/proxy";
import { Rect } from "../util/rect";
import { Log } from "../util/log";

/**
 * Surface provided by KWin. Surface is essentially a screen space, but
 * it can represent a surface, that is not currently displayed, e.g. a
 * virtual desktop.
 */
export interface DriverSurface {
  /**
   * Surface unique id
   */
  readonly id: string;

  /**
   * Should the surface be completely ignored by the script.
   */
  readonly ignore: boolean;

  /**
   * The area in which windows are placed.
   */
  readonly workingArea: Readonly<Rect>;

  screen: number;

  group: number;

  /**
   * The next surface. The next surface is a virtual desktop, that comes after current one.
   */
  next(): DriverSurface | null;
}

export class DriverSurfaceImpl implements DriverSurface {
  public readonly id: string;
  public readonly ignore: boolean;
  public workingArea: Rect;

  constructor(
    private _screen: number,
    public readonly activity: string,
    public readonly desktop: number,
    private activityInfo: Plasma.TaskManager.ActivityInfo,
    private config: Config,
    private proxy: TSProxy,
    private log: Log
  ) {
    this.id = this.generateId();

    // this.log.log(`surface made with ${_group}`);

    const activityName = activityInfo.activityName(activity);
    this.ignore =
      this.config.ignoreActivity.indexOf(activityName) >= 0 ||
      this.config.ignoreScreen.indexOf(this.screen) >= 0;

    this.workingArea = Rect.fromQRect(
      this.proxy.workspace().clientArea(
        0, // This is PlacementArea
        this.screen,
        desktop
      )
    );
  }

  public next(): DriverSurface | null {
    // This is the last virtual desktop
    if (this.desktop === this.proxy.workspace().desktops) {
      return null;
    }

    return new DriverSurfaceImpl(
      this.screen,
      this.activity,
      this.desktop + 1,
      this.activityInfo,
      this.config,
      this.proxy,
      this.log
    );
  }

  public set screen(screen: number) {
    this._screen = screen;
  }

  public get screen(): number {
    return this._screen;
  }

  public get group(): number {
    let g = this.proxy.getSurfaceGroup(this.desktop, this.screen);
    if (!g) {
      const customScreenOrder = [4, 1, 3, 2, 5, 6, 7, 8, 9];
      g = (this.desktop - 1) * 5 + customScreenOrder[this.screen];
      this.log.log(`initialize ${this.desktop}:${this.screen} to group ${g}`);
      this.group = g;
    }
    return g;
  }

  public set group(groupID: number) {
    this.log.log(`setSurfaceGroup: ${this.desktop}:${this.screen} ${groupID}`);
    this.proxy.setSurfaceGroup(this.desktop, this.screen, groupID);
  }

  public toString(): string {
    const activityName = this.activityInfo.activityName(this.activity);
    return `DriverSurface(${this.screen}, ${activityName}, ${this.desktop})`;
  }

  private generateId(): string {
    let path = String(this.screen);
    if (this.config.layoutPerActivity) {
      path += `@${this.activity}`;
    }
    if (this.config.layoutPerDesktop) {
      path += `"#${this.desktop}`;
    }
    return path;
  }
}
