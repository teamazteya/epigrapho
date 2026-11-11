/*
This file is part of the Epigrapho project (https://github.com/teamazteya/epigrapho)

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

import { strings } from "@notesnook/intl";
import { useThemeColors } from "@notesnook/theme";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useRef, useState } from "react";
import {
  AccessibilityInfo,
  Image,
  Modal,
  ScrollView,
  TouchableOpacity,
  useWindowDimensions,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WELCOME_CAPTURES } from "../../assets/welcome";
import { getUiLocale } from "../../common/ui-locale";
import Navigation from "../../services/navigation";
import SettingsService from "../../services/settings";
import { useSettingStore } from "../../stores/use-setting-store";
import { AppFontSize } from "../../utils/size";
import { DefaultAppStyles } from "../../utils/styles";
import AppIcon from "../ui/AppIcon";
import { Button } from "../ui/button";
import Heading from "../ui/typography/heading";
import Paragraph from "../ui/typography/paragraph";

type Shot = keyof typeof strings.welcome.shots;

/** The real Android captures on each of the nine pages. */
const SHOTS: Shot[][] = [
  ["editor", "notes"],
  ["preview", "block"],
  ["crossReferences", "parallel"],
  ["dictionary"],
  ["interlinear", "lexicon", "concordance"],
  ["plan", "reading"],
  ["templates", "sermon"],
  ["themes", "export"],
  ["share"]
];
// The captures are 540 × 1200, a phone screen.
const RATIO = 1200 / 540;

/**
 * Epigrapho A6 (Fase 9): the welcome center. It replaces Notesnook's intro: a
 * new install opens it, and so does every start while "Don't show again" is
 * unchecked; Settings → Help and support opens it again.
 */
const Intro = ({ navigation }: NativeStackScreenProps<any>) => {
  const { colors } = useThemeColors();
  const { width, height } = useWindowDimensions();
  const scroll = useRef<ScrollView>(null);
  const [step, setStep] = useState(0);
  const [shotIndex, setShotIndex] = useState(0);
  const [hide, setHide] = useState(
    () => !useSettingStore.getState().settings.welcomeShow
  );
  const [indexOpen, setIndexOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const welcome = strings.welcome;
  const page = welcome.pages[step];
  const shots = SHOTS[step];
  const shot = shots[shotIndex];
  const caption = welcome.shots[shot]();
  const title = (page.mobileTitle ?? page.title)();
  const language = getUiLocale() === "en-US" ? "en" : "es";
  const capture =
    WELCOME_CAPTURES[language][
      `${String(step + 1).padStart(
        2,
        "0"
      )}-${shot}` as keyof (typeof WELCOME_CAPTURES)["es"]
    ];
  const last = step === welcome.pages.length - 1;
  // A whole phone screen, as tall as most of this one allows.
  const captureWidth = Math.min(
    width - DefaultAppStyles.GAP * 4,
    (height * 0.62) / RATIO
  );

  function go(to: number) {
    setStep(to);
    setShotIndex(0);
    setIndexOpen(false);
    // No animation: the page changes at once, with or without reduced motion.
    scroll.current?.scrollTo({ y: 0, animated: false });
    AccessibilityInfo.announceForAccessibility(
      `${welcome.count(to + 1)}. ${(
        welcome.pages[to].mobileTitle ?? welcome.pages[to].title
      )()}`
    );
  }

  function close(firstNote = false) {
    SettingsService.set({ introCompleted: true, welcomeShow: !hide });
    if (firstNote) {
      // The app's "New note" shortcut opens the editor on a new note
      // (navigation-stack.tsx).
      useSettingStore.setState({
        pendingShortcut: {
          type: "epigrapho.action.newnote",
          title: welcome.createFirstNote()
        }
      });
      return;
    }
    if (navigation.canGoBack()) navigation.goBack();
    else Navigation.navigate("FluidPanelsView", {});
  }

  return (
    <SafeAreaView
      edges={["top", "bottom", "left", "right"]}
      style={{ flex: 1, backgroundColor: colors.primary.background }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: DefaultAppStyles.GAP_SMALL,
          paddingHorizontal: DefaultAppStyles.GAP,
          paddingVertical: DefaultAppStyles.GAP_VERTICAL_SMALL,
          borderBottomWidth: 1,
          borderBottomColor: colors.primary.border
        }}
      >
        <Image
          source={require("../../assets/images/epigrapho-logo.png")}
          style={{ width: 32, height: 32 }}
          accessibilityIgnoresInvertColors
        />
        <View style={{ flex: 1 }}>
          <Heading size={AppFontSize.lg} accessibilityRole="header">
            Epigrapho
          </Heading>
          <Paragraph size={AppFontSize.xs} color={colors.secondary.paragraph}>
            {welcome.title()}
          </Paragraph>
        </View>
        <Paragraph
          testID="welcome-count"
          size={AppFontSize.xs}
          color={colors.secondary.paragraph}
        >
          {welcome.count(step + 1)}
        </Paragraph>
        <Button
          testID="welcome-close"
          title={strings.close()}
          type="plain"
          height={40}
          onPress={() => close()}
        />
      </View>

      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={{
          padding: DefaultAppStyles.GAP,
          gap: DefaultAppStyles.GAP_VERTICAL
        }}
      >
        <TouchableOpacity
          testID="welcome-index"
          activeOpacity={0.8}
          accessibilityRole="button"
          // Without it, the reader also says the chevron's glyph.
          accessibilityLabel={welcome.indexSummary()}
          accessibilityState={{ expanded: indexOpen }}
          onPress={() => setIndexOpen(!indexOpen)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: DefaultAppStyles.GAP_SMALL,
            minHeight: 44
          }}
        >
          <AppIcon
            name={indexOpen ? "chevron-down" : "chevron-right"}
            color={colors.primary.icon}
            size={AppFontSize.lg}
          />
          <Paragraph style={{ flex: 1 }}>{welcome.indexSummary()}</Paragraph>
        </TouchableOpacity>
        {indexOpen ? (
          <View accessibilityLabel={welcome.indexLabel()}>
            {welcome.pages.map((item, index) => (
              <TouchableOpacity
                key={index}
                testID={`welcome-step-${index + 1}`}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ selected: index === step }}
                onPress={() => go(index)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: DefaultAppStyles.GAP,
                  minHeight: 44,
                  paddingHorizontal: DefaultAppStyles.GAP_SMALL,
                  borderRadius: 7,
                  backgroundColor:
                    index === step ? colors.selected.background : "transparent"
                }}
              >
                <Paragraph
                  size={AppFontSize.xs}
                  color={colors.secondary.paragraph}
                >
                  {String(index + 1).padStart(2, "0")}
                </Paragraph>
                <Paragraph style={{ flex: 1 }}>{item.nav()}</Paragraph>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        <Heading
          testID="welcome-title"
          accessibilityRole="header"
          extraBold
          size={AppFontSize.xxl}
        >
          {title}
        </Heading>
        <Paragraph size={AppFontSize.sm}>
          {(page.mobileBody ?? page.body)()}
        </Paragraph>

        <View
          style={{
            borderWidth: 1,
            borderColor: colors.primary.border,
            borderRadius: 8,
            overflow: "hidden"
          }}
        >
          {shots.length > 1 ? (
            <View
              accessibilityLabel={welcome.captureViews()}
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 5,
                padding: 8,
                borderBottomWidth: 1,
                borderBottomColor: colors.primary.border
              }}
            >
              {shots.map((item, index) => (
                <Button
                  key={item}
                  testID={`welcome-shot-${item}`}
                  title={welcome.shots[item]()}
                  type={index === shotIndex ? "selected" : "plain"}
                  height={40}
                  fontSize={AppFontSize.xs}
                  accessibilityState={{ selected: index === shotIndex }}
                  onPress={() => setShotIndex(index)}
                />
              ))}
            </View>
          ) : null}
          <TouchableOpacity
            testID="welcome-zoom"
            activeOpacity={0.8}
            accessibilityRole="imagebutton"
            accessibilityLabel={welcome.zoomOf(caption)}
            onPress={() => setZoomed(true)}
            style={{ alignItems: "center", paddingVertical: 12, gap: 8 }}
          >
            <Image
              testID="welcome-capture"
              source={capture}
              accessibilityIgnoresInvertColors
              style={{
                width: captureWidth,
                height: captureWidth * RATIO,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: colors.primary.border
              }}
            />
            <Paragraph
              size={AppFontSize.xs}
              color={colors.primary.accent}
              style={{ textDecorationLine: "underline" }}
            >
              {welcome.zoom()}
            </Paragraph>
          </TouchableOpacity>
          <View
            style={{
              padding: 12,
              borderTopWidth: 1,
              borderTopColor: colors.primary.border
            }}
          >
            <Paragraph size={AppFontSize.xs}>{caption}</Paragraph>
            <Paragraph
              size={AppFontSize.xxs}
              color={colors.secondary.paragraph}
            >
              {welcome.captureAndroid()}
            </Paragraph>
          </View>
        </View>

        <Paragraph size={AppFontSize.xs} color={colors.secondary.paragraph}>
          {(page.mobileTip ?? page.tip)()}
        </Paragraph>

        <TouchableOpacity
          testID="welcome-dont-show"
          activeOpacity={0.8}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: hide }}
          onPress={() => setHide(!hide)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: DefaultAppStyles.GAP_SMALL,
            minHeight: 44
          }}
        >
          <AppIcon
            name={hide ? "checkbox-marked" : "checkbox-blank-outline"}
            color={hide ? colors.primary.accent : colors.primary.icon}
            size={AppFontSize.lg}
          />
          <Paragraph style={{ flex: 1 }} size={AppFontSize.sm}>
            {welcome.dontShow()}
          </Paragraph>
        </TouchableOpacity>
        <Paragraph size={AppFontSize.xxs} color={colors.secondary.paragraph}>
          {welcome.reopen()}
        </Paragraph>
      </ScrollView>

      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          gap: DefaultAppStyles.GAP_SMALL,
          paddingHorizontal: DefaultAppStyles.GAP,
          paddingVertical: DefaultAppStyles.GAP_VERTICAL_SMALL,
          borderTopWidth: 1,
          borderTopColor: colors.primary.border
        }}
      >
        <Button
          testID="welcome-enter"
          title={welcome.enter()}
          type="plain"
          onPress={() => close()}
          style={{ flexGrow: 1, justifyContent: "flex-start" }}
        />
        {/* Back and next wrap together, on the right, on a narrow screen. */}
        <View
          style={{
            flexDirection: "row",
            gap: DefaultAppStyles.GAP_SMALL,
            marginLeft: "auto"
          }}
        >
          <Button
            testID="welcome-back"
            title={strings.back()}
            type="secondary"
            disabled={step === 0}
            style={{ opacity: step === 0 ? 0.4 : 1 }}
            onPress={() => go(step - 1)}
          />
          {last ? (
            <Button
              testID="welcome-first-note"
              title={welcome.createFirstNote()}
              type="accent"
              onPress={() => close(true)}
            />
          ) : (
            <Button
              testID="welcome-next"
              title={strings.next()}
              type="accent"
              onPress={() => go(step + 1)}
            />
          )}
        </View>
      </View>

      <Modal
        visible={zoomed}
        animationType="none"
        onRequestClose={() => setZoomed(false)}
      >
        <SafeAreaView
          style={{ flex: 1, backgroundColor: colors.primary.background }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              padding: DefaultAppStyles.GAP_SMALL,
              paddingHorizontal: DefaultAppStyles.GAP
            }}
          >
            <Heading
              size={AppFontSize.md}
              style={{ flex: 1 }}
              accessibilityRole="header"
            >
              {caption}
            </Heading>
            <Button
              testID="welcome-zoom-close"
              title={strings.close()}
              type="secondary"
              onPress={() => setZoomed(false)}
            />
          </View>
          <Image
            source={capture}
            resizeMode="contain"
            accessibilityLabel={welcome.captureAlt(caption)}
            style={{ flex: 1, width: "100%" }}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

export default Intro;
