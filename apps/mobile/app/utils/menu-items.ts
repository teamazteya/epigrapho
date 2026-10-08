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

import { Item, ItemType } from "@notesnook/core";
import { strings } from "@notesnook/intl";
import { Monographs } from "../screens/notes/monographs";
import Navigation from "../services/navigation";

export type SideMenuItem = {
  dataType?: ItemType | "monograph";
  data?: Item;
  title: string;
  id: string;
  icon: string;
  onPress?: (item: SideMenuItem) => void;
  onLongPress?: (item: SideMenuItem) => void;
  type: string;
};

export const MenuItemsList: SideMenuItem[] = [
  {
    dataType: "note",
    id: "Notes",
    title: "Notes",
    icon: "note-outline",
    type: "side-menu-item"
  },
  // {
  //   dataType: "notebook",
  //   id: "Notebooks",
  //   title: "Notebooks",
  //   icon: "book-outline"
  // },
  {
    dataType: "note",
    id: "Favorites",
    title: "Favorites",
    icon: "star-outline",
    type: "side-menu-item"
  },
  // {
  //   dataType: "tag",
  //   id: "Tags",
  //   title: "Tags",
  //   icon: "pound"
  // },
  {
    dataType: "reminder",
    id: "Reminders",
    title: "Reminders",
    icon: "bell",
    type: "side-menu-item"
  },
  // Epigrapho (A3 Fase 3, M1 Fase 5c): the reading plans, as a sheet.
  {
    id: "ReadingPlans",
    title: strings.readingPlans.title(),
    icon: "book-open-page-variant-outline",
    onPress: () => {
      Navigation.closeDrawer();
      // Required here: the sheet reaches the editor, which loads after this.
      require("../components/sheets/reading-plans").default.present();
    },
    type: "side-menu-item"
  },
  {
    dataType: "monograph",
    id: "Monographs",
    title: "Monographs",
    icon: "text-box-multiple-outline",
    onPress: () => {
      Navigation.closeDrawer();
      Monographs.navigate();
    },
    type: "side-menu-item"
  },
  {
    dataType: "note",
    id: "Archive",
    title: "Archive",
    icon: "archive",
    type: "side-menu-item"
  },
  {
    dataType: "note",
    id: "Trash",
    title: "Trash",
    icon: "delete-outline",
    type: "side-menu-item"
  }
];
