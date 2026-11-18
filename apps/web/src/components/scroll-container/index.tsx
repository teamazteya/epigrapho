/*
This file is part of the Notesnook project (https://notesnook.com/)

Copyright (C) 2023 Streetwriters (Private) Limited

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

import React, { PropsWithChildren } from "react";
import { MacScrollbar, MacScrollbarProps } from "mac-scrollbar";
import "mac-scrollbar/dist/mac-scrollbar.css";

/**
 * Epigrapho (W2): on a touch screen the custom scrollbar only costs work on
 * every scroll frame, and the system draws its own; a plain scrolling div.
 */
const IS_TOUCH =
  typeof window !== "undefined" &&
  window.matchMedia("(pointer: coarse)").matches;

const TouchScroll = React.forwardRef<
  HTMLDivElement,
  PropsWithChildren<MacScrollbarProps>
>(function TouchScroll(props, ref) {
  const {
    skin: _skin,
    trackGap: _trackGap,
    trackStyle: _trackStyle,
    thumbStyle: _thumbStyle,
    minThumbSize: _minThumbSize,
    suppressAutoHide: _suppressAutoHide,
    as: _as,
    suppressScrollX,
    suppressScrollY,
    style,
    ...rest
  } = props;
  return (
    <div
      {...(rest as React.HTMLAttributes<HTMLDivElement>)}
      ref={ref}
      style={{
        overflowX: suppressScrollX ? "hidden" : "auto",
        overflowY: suppressScrollY ? "hidden" : "auto",
        ...style
      }}
    />
  );
});

export type ScrollContainerProps = {
  style?: React.CSSProperties;
  forwardedRef?: (ref: HTMLDivElement | null) => void;
} & MacScrollbarProps;

const ScrollContainer = ({
  children,
  forwardedRef,
  style,
  ...props
}: PropsWithChildren<ScrollContainerProps>) => {
  const Scroll = IS_TOUCH ? TouchScroll : MacScrollbar;
  return (
    <Scroll
      suppressScrollX
      minThumbSize={40}
      {...props}
      ref={(div) => {
        forwardedRef && forwardedRef(div as HTMLDivElement);
      }}
      style={{
        position: "relative",
        height: "100%",
        ...style
      }}
    >
      {children}
    </Scroll>
  );
};
export default ScrollContainer;

type FlexScrollContainerProps = {
  id?: string;
  className?: string;
  style?: React.CSSProperties;
  scrollRef?: React.Ref<HTMLElement>;
} & MacScrollbarProps;

export function FlexScrollContainer({
  id,
  children,
  style,
  className,
  scrollRef,
  ...restProps
}: PropsWithChildren<FlexScrollContainerProps>) {
  const Scroll = IS_TOUCH ? TouchScroll : MacScrollbar;
  return (
    <Scroll
      {...restProps}
      ref={scrollRef as React.Ref<HTMLDivElement>}
      id={id}
      className={className}
      style={style}
      minThumbSize={40}
    >
      {children}
    </Scroll>
  );
}
