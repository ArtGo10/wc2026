import { useAuth, useClerk, useUser } from "@clerk/expo";
import type { Id } from "../../../convex/_generated/dataModel";
import { useAction, useConvexAuth, useMutation } from "convex/react";
import { Image } from "expo-image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Bell, Check, ChevronDown } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AuthScreen } from "../../components/auth/AuthScreen";
import {
  TOKEN_FETCH_TIMEOUT_MS,
  WEB_APP_PATH,
  WEB_DESKTOP_MIN_WIDTH,
} from "../../constants";
import { AppConnectionProblemScreen } from "../../components/common/AppConnectionProblemScreen";
import { AppLoadingOverlay } from "../../components/common/AppLoadingOverlay";
import { AppLoadingScreen } from "../../components/common/AppLoadingScreen";
import { LanguageSwitcher } from "../../components/common/LanguageSwitcher";
import { useCurrentUserBootstrap } from "../../hooks/useCurrentUserBootstrap";
import { useDismissKeyboardOnChange } from "../../hooks/useDismissKeyboardOnChange";
import { useSafeQuery } from "../../hooks/useSafeQuery";
import { clearStoredLegalAcceptance } from "../../legal/legalAcceptanceStorage";
import { useExpoPushTokenRegistration } from "../../hooks/usePushNotifications";
import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/translations";
import { api } from "../../lib/convexApi";
import { styles } from "../../styles";
import { colors, spacing } from "../../theme/tokens";
import {
  clearPendingWebOAuthAttempt,
  getErrorMessage,
  getMetadataDisplayName,
  getWebAppRedirectUrl,
  keepBrowserOnWebAppPath,
} from "../../utils/auth";
import { formatPersonName } from "../../utils/names";
import { FantasyBottomTabs } from "./FantasyBottomTabs";
import {
  HeaderActionOverlay,
  type HeaderActionOverlayConfig,
} from "./components/HeaderActionOverlay";
import { BottomSheet } from "./components/BottomSheet";
import { SeasonScreen } from "./screens/SeasonScreen";
import { LeagueScreen } from "./screens/LeagueScreen";
import { MarketScreen } from "./screens/MarketScreen";
import { MyTeamScreen } from "./screens/MyTeamScreen";
import { NotificationsScreen } from "./screens/NotificationsScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import {
  FANTASY_CRITICAL_IMAGE_MODULES,
  FANTASY_STATIC_IMAGE_PROPS,
  getFantasySeasonSmallLogoSource,
  preloadFantasyStaticAssets,
} from "./assets/fantasyAssets";
import type { FantasyTab, FantasyTabId } from "./types";
import {
  localizeFantasyClubs,
  localizeFantasyFixtures,
  localizeFantasyGameweeks,
  localizeFantasyPlayers,
  localizeFantasyTeam,
} from "./utils/localizedFantasyData";
import {
  clearStoredFantasySeasonSlug,
  getStoredFantasySeasonSlug,
  storeFantasySeasonSlug,
} from "./utils/seasonSelectionStorage";
import {
  getFantasySeasonDisplayDescription,
  getFantasySeasonDisplaySubtitle,
  getFantasySeasonDisplayTitle,
} from "./utils/seasonDisplay";
import {
  colorWithAlpha,
  getFantasySeasonAccentColor,
  getFantasySeasonPrimaryColor,
  getFantasySeasonSoftColor,
} from "./utils/seasonVisuals";
import { FantasySeasonThemeProvider } from "./utils/seasonThemeContext";

const FANTASY_TABS: FantasyTab[] = [
  { id: "team" },
  { id: "league" },
  { id: "market" },
  { id: "season" },
  { id: "profile" },
];

const FANTASY_TAB_LABEL_KEYS: Record<FantasyTabId, TranslationKey> = {
  season: "tabs.season",
  league: "tabs.league",
  market: "tabs.market",
  profile: "tabs.profile",
  team: "tabs.team",
};

const FANTASY_TAB_WEB_PATHS: Record<FantasyTabId, string> = {
  team: `${WEB_APP_PATH}/team`,
  league: `${WEB_APP_PATH}/league`,
  market: `${WEB_APP_PATH}/market`,
  season: `${WEB_APP_PATH}/season`,
  profile: `${WEB_APP_PATH}/profile`,
};

const FANTASY_WEB_TAB_IDS = new Set<FantasyTabId>(
  FANTASY_TABS.map((tab) => tab.id),
);

type FantasySeasonTheme = {
  accentColor: string;
  primaryColor: string;
  secondaryColor: string;
};

type FantasySeasonOption = {
  accessLevel?: "admin" | "public";
  country: string;
  description?: string | null;
  displayName?: string | null;
  id: string;
  leagueName: string;
  isLocked?: boolean;
  lockedReason?: string | null;
  logoKey?: string | null;
  name: string;
  shortName?: string | null;
  slug: string;
  status: string;
  theme?: FantasySeasonTheme | null;
};

function normalizeFantasyWebPathname(pathname: string) {
  const cleanPathname = pathname.split("?")[0]?.split("#")[0] ?? WEB_APP_PATH;
  if (!cleanPathname || cleanPathname === "/") return "/";

  return cleanPathname.replace(/\/+$/, "") || "/";
}

function getFantasyTabFromWebPathname(pathname: string): FantasyTabId | null {
  const normalizedPathname = normalizeFantasyWebPathname(pathname);
  if (normalizedPathname === WEB_APP_PATH) return "team";

  const appPrefix = `${WEB_APP_PATH}/`;
  if (!normalizedPathname.startsWith(appPrefix)) return null;

  const tabSegment = normalizedPathname.slice(appPrefix.length).split("/")[0];
  return FANTASY_WEB_TAB_IDS.has(tabSegment as FantasyTabId)
    ? (tabSegment as FantasyTabId)
    : null;
}

function isUnknownFantasyWebTabPathname(pathname: string) {
  const normalizedPathname = normalizeFantasyWebPathname(pathname);
  return (
    normalizedPathname.startsWith(`${WEB_APP_PATH}/`) &&
    getFantasyTabFromWebPathname(normalizedPathname) === null
  );
}

function getInitialFantasyTab() {
  if (Platform.OS !== "web" || typeof window === "undefined") return "team";

  return getFantasyTabFromWebPathname(window.location.pathname) ?? "team";
}

function getFantasySeasonLogoSource(
  season: FantasySeasonOption | null | undefined,
) {
  return getFantasySeasonSmallLogoSource(season);
}

function normalizeSeasonAccessValue(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase();
}

function isAdminOnlyFantasySeasonOption(
  season: FantasySeasonOption | null | undefined,
) {
  if (!season) return false;

  const candidates = [
    season.accessLevel,
    season.slug,
    season.logoKey,
    season.displayName,
    season.leagueName,
    season.name,
    season.shortName,
  ]
    .map(normalizeSeasonAccessValue)
    .filter(Boolean);

  return candidates.some(
    (candidate) =>
      candidate === "admin" ||
      candidate === "polish-ekstraklasa" ||
      candidate.includes("polish-futsal-ekstraklasa") ||
      candidate.includes("polish-ekstraklasa") ||
      candidate.includes("polish ekstraklasa") ||
      candidate.includes("polska ekstraklasa"),
  );
}

type ConvexTokenStatus = "idle" | "loading" | "ready" | "failed";

const CONVEX_AUTH_PROBLEM_GRACE_MS = 30000;
const PRIVATE_LOADING_OVERLAY_TIMEOUT_MS = 15000;
const CONNECTION_TOAST_DURATION_MS = 3500;
const CONNECTION_TOAST_RESUME_GRACE_MS = 8000;
const CONVEX_TOKEN_WARMUP_ATTEMPTS = 24;
const CONVEX_TOKEN_WARMUP_DELAY_MS = 500;
const CONVEX_TOKEN_WARMUP_TOTAL_TIMEOUT_MS = 15000;
const NATIVE_FOREGROUND_SESSION_REFRESH_GRACE_MS = 60 * 1000;
const WEB_FOREGROUND_SESSION_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

function waitForNextPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}
const wait = (delayMs: number) =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("Timed out while warming up Convex token.")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function useLastDefinedValue<T>(
  value: T | undefined,
  cacheKey: string | undefined,
) {
  const cachedRef = useRef<{
    cacheKey: string | undefined;
    value: T | undefined;
  }>({ cacheKey, value: undefined });

  if (cachedRef.current.cacheKey !== cacheKey) {
    cachedRef.current = { cacheKey, value: undefined };
  }

  if (value !== undefined) {
    cachedRef.current.value = value;
  }

  return value === undefined ? cachedRef.current.value : value;
}

function FantasyStaticImagePreloader() {
  return (
    <View pointerEvents="none" style={styles.staticImagePreloadLayer}>
      {FANTASY_CRITICAL_IMAGE_MODULES.map((source, index) => (
        <Image
          {...FANTASY_STATIC_IMAGE_PROPS}
          contentFit="cover"
          key={index}
          recyclingKey={`fantasy-critical-preload-${index}`}
          source={source}
          style={styles.staticImagePreloadImage}
        />
      ))}
    </View>
  );
}

function FantasySeasonOptionCard({
  onSelect,
  season,
}: {
  onSelect: (season: FantasySeasonOption) => void;
  season: FantasySeasonOption;
}) {
  const { t } = useI18n();
  const title = getFantasySeasonDisplayTitle(season, t, t("app.title"));
  const subtitle = getFantasySeasonDisplaySubtitle(season, t);
  const description = getFantasySeasonDisplayDescription(
    season,
    t,
    season.description,
  );
  const seasonPrimaryColor = getFantasySeasonPrimaryColor(season);
  const seasonAccentColor = getFantasySeasonAccentColor(season);
  const isLocked = Boolean(season.isLocked);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isLocked }}
      disabled={isLocked}
      onPress={isLocked ? undefined : () => onSelect(season)}
      style={[
        styles.seasonSelectionCard,
        { borderColor: seasonAccentColor },
        isLocked ? styles.seasonSelectionCardLocked : null,
      ]}
    >
      <Image
        {...FANTASY_STATIC_IMAGE_PROPS}
        contentFit="contain"
        source={getFantasySeasonLogoSource(season)}
        style={styles.seasonSelectionLogo}
      />
      <View style={styles.seasonSelectionCardTextGroup}>
        <Text numberOfLines={1} style={styles.seasonSelectionCardTitle}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={styles.seasonSelectionCardMeta}>
            {subtitle}
          </Text>
        ) : null}
        {description ? (
          <Text numberOfLines={2} style={styles.seasonSelectionCardDescription}>
            {description}
          </Text>
        ) : null}
      </View>
      <View
        style={[
          styles.seasonSelectionCardAction,
          isLocked
            ? [
                styles.seasonSelectionCardActionLocked,
                {
                  backgroundColor: colorWithAlpha(seasonPrimaryColor, 0.1),
                  borderColor: colorWithAlpha(seasonPrimaryColor, 0.28),
                },
              ]
            : { backgroundColor: seasonPrimaryColor },
        ]}
      >
        <Text
          style={[
            styles.seasonSelectionCardActionText,
            isLocked
              ? [
                  styles.seasonSelectionCardActionTextLocked,
                  { color: seasonPrimaryColor },
                ]
              : null,
          ]}
        >
          {isLocked ? t("seasonSelection.soon") : t("seasonSelection.choose")}
        </Text>
      </View>
    </Pressable>
  );
}

function FantasySeasonSelectionScreen({
  onSelect,
  seasons,
}: {
  onSelect: (season: FantasySeasonOption) => void;
  seasons: FantasySeasonOption[];
}) {
  const { t } = useI18n();

  return (
    <ScrollView
      style={styles.fantasyScreen}
      contentContainerStyle={styles.seasonSelectionScreen}
    >
      <View style={styles.seasonSelectionIntro}>
        <Text style={styles.seasonSelectionKicker}>
          {t("seasonSelection.kicker")}
        </Text>
        <Text style={styles.seasonSelectionTitle}>
          {t("seasonSelection.title")}
        </Text>
        <Text style={styles.seasonSelectionDescription}>
          {t("seasonSelection.description")}
        </Text>
      </View>

      {seasons.length > 0 ? (
        <View style={styles.seasonSelectionGrid}>
          {seasons.map((season) => (
            <FantasySeasonOptionCard
              key={season.slug}
              onSelect={onSelect}
              season={season}
            />
          ))}
        </View>
      ) : (
        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>
            {t("seasonSelection.emptyTitle")}
          </Text>
          <Text style={styles.mutedText}>
            {t("seasonSelection.emptyDescription")}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function FantasySeasonPickerSheet({
  activeSeasonSlug,
  onClose,
  onSelect,
  seasons,
  visible,
}: {
  activeSeasonSlug: string | null;
  onClose: () => void;
  onSelect: (season: FantasySeasonOption) => void;
  seasons: FantasySeasonOption[];
  visible: boolean;
}) {
  const { t } = useI18n();

  return (
    <BottomSheet
      contentScrollEnabled={false}
      onClose={onClose}
      visible={visible}
    >
      <View style={styles.seasonPickerSheetContent}>
        <View style={styles.leagueActionsHeader}>
          <Text style={styles.sectionTitle}>{t("seasonSelection.switch")}</Text>
          <Text style={styles.mutedText}>
            {t("seasonSelection.switchDescription")}
          </Text>
        </View>
        <ScrollView
          style={styles.seasonPickerScroll}
          contentContainerStyle={styles.seasonPickerOptions}
        >
          {seasons.map((season) => {
            const isSelected = season.slug === activeSeasonSlug;
            const isLocked = Boolean(season.isLocked);
            const seasonPrimaryColor = getFantasySeasonPrimaryColor(season);
            const seasonSoftColor = getFantasySeasonSoftColor(season);
            const seasonTitle = getFantasySeasonDisplayTitle(
              season,
              t,
              season.name,
            );
            const seasonSubtitle = getFantasySeasonDisplaySubtitle(
              season,
              t,
              season.name,
            );
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: isLocked, selected: isSelected }}
                disabled={isLocked}
                key={season.slug}
                onPress={isLocked ? undefined : () => onSelect(season)}
                style={[
                  styles.seasonPickerOption,
                  isLocked ? styles.seasonPickerOptionLocked : null,
                  isSelected && !isLocked
                    ? [
                        styles.seasonPickerOptionSelected,
                        {
                          backgroundColor: seasonSoftColor,
                          borderColor: colorWithAlpha(seasonPrimaryColor, 0.35),
                        },
                      ]
                    : null,
                ]}
              >
                <Image
                  {...FANTASY_STATIC_IMAGE_PROPS}
                  contentFit="contain"
                  source={getFantasySeasonLogoSource(season)}
                  style={styles.seasonPickerOptionLogo}
                />
                <View style={styles.seasonPickerOptionTextGroup}>
                  <Text numberOfLines={1} style={styles.seasonPickerOptionText}>
                    {seasonTitle}
                  </Text>
                  <Text numberOfLines={1} style={styles.seasonPickerOptionMeta}>
                    {seasonSubtitle}
                  </Text>
                </View>
                {isLocked ? (
                  <View
                    style={[
                      styles.seasonPickerSoonBadge,
                      {
                        backgroundColor: colorWithAlpha(seasonPrimaryColor, 0.1),
                        borderColor: colorWithAlpha(seasonPrimaryColor, 0.28),
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.seasonPickerSoonBadgeText,
                        { color: seasonPrimaryColor },
                      ]}
                    >
                      {t("seasonSelection.soon")}
                    </Text>
                  </View>
                ) : isSelected ? (
                  <Check
                    color={seasonPrimaryColor}
                    size={18}
                    strokeWidth={3}
                  />
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </BottomSheet>
  );
}

function FantasyShellHeader({
  activeSeason,
  activeTab,
  onNotificationsPress,
  onSeasonSelectPress,
  onTabChange,
  seasonOptions,
  showLanguageSwitcher = false,
  showWebNav = true,
  tabs,
  unreadNotificationsCount = 0,
}: {
  activeSeason?: FantasySeasonOption | null;
  activeTab: FantasyTabId;
  onNotificationsPress: () => void;
  onSeasonSelectPress?: () => void;
  onTabChange: (tab: FantasyTabId) => void;
  seasonOptions?: FantasySeasonOption[];
  showLanguageSwitcher?: boolean;
  showWebNav?: boolean;
  tabs: FantasyTab[];
  unreadNotificationsCount?: number;
}) {
  const { t } = useI18n();
  const shouldShowLanguageSwitcher =
    Platform.OS === "web" && showLanguageSwitcher;
  const shouldShowWebNav = Platform.OS === "web" && showWebNav;
  const canSelectSeason =
    Boolean(activeSeason && onSeasonSelectPress) &&
    (seasonOptions?.length ?? 0) > 1;
  const titleText = getFantasySeasonDisplayTitle(
    activeSeason,
    t,
    t("app.title"),
  );
  const seasonPrimaryColor = getFantasySeasonPrimaryColor(activeSeason);
  const seasonAccentColor = getFantasySeasonAccentColor(activeSeason);
  const seasonSoftColor = getFantasySeasonSoftColor(activeSeason);
  const notificationBadgeText =
    unreadNotificationsCount > 99 ? "99+" : String(unreadNotificationsCount);

  return (
    <View style={[styles.fantasyHeader, { borderColor: seasonAccentColor }]}>
      <View style={styles.fantasyHeaderTitleGroup}>
        <Pressable
          accessibilityRole={canSelectSeason ? "button" : undefined}
          disabled={!canSelectSeason}
          onPress={onSeasonSelectPress}
          style={styles.fantasyHeaderTitleRow}
        >
          <Image
            {...FANTASY_STATIC_IMAGE_PROPS}
            contentFit="contain"
            source={getFantasySeasonLogoSource(activeSeason)}
            style={styles.fantasyHeaderLogo}
          />
          <Text
            numberOfLines={1}
            style={[styles.fantasyAppTitle, { color: seasonPrimaryColor }]}
          >
            {titleText}
          </Text>
          {canSelectSeason ? (
            <ChevronDown
              color={seasonPrimaryColor}
              size={17}
              strokeWidth={2.6}
            />
          ) : null}
        </Pressable>
      </View>

      {shouldShowWebNav ? (
        <View style={styles.fantasyHeaderWebNav}>
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const label = t(FANTASY_TAB_LABEL_KEYS[tab.id]);

            return (
              <Pressable
                accessibilityRole="link"
                accessibilityState={{ selected: isActive }}
                key={tab.id}
                onPress={() => onTabChange(tab.id)}
                style={[
                  styles.fantasyHeaderWebNavButton,
                  isActive
                    ? [
                        styles.fantasyHeaderWebNavButtonActive,
                        { backgroundColor: seasonSoftColor },
                      ]
                    : null,
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    isActive
                      ? styles.fantasyHeaderWebNavTextActive
                      : styles.fantasyHeaderWebNavText,
                    isActive ? { color: seasonPrimaryColor } : null,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {shouldShowLanguageSwitcher ? (
        <View style={styles.fantasyHeaderLanguageSwitcher}>
          <LanguageSwitcher activeColor={seasonPrimaryColor} />
        </View>
      ) : (
        <Pressable
          accessibilityLabel={t("notifications.title")}
          accessibilityRole="button"
          onPress={onNotificationsPress}
          style={[
            styles.fantasyHeaderIconButton,
            {
              backgroundColor: colorWithAlpha(seasonPrimaryColor, 0.1),
              borderColor: colorWithAlpha(seasonPrimaryColor, 0.35),
            },
          ]}
        >
          <Bell color={seasonPrimaryColor} size={21} strokeWidth={2.4} />
          {unreadNotificationsCount > 0 ? (
            <View style={styles.fantasyHeaderNotificationBadge}>
              <Text style={styles.fantasyHeaderNotificationBadgeText}>
                {notificationBadgeText}
              </Text>
            </View>
          ) : null}
        </Pressable>
      )}
    </View>
  );
}

export function FantasyHome({
  isOffline = false,
  onTopEdgeToEdgeChange,
}: {
  isOffline?: boolean;
  onTopEdgeToEdgeChange?: (isEnabled: boolean) => void;
} = {}) {
  const { language, t } = useI18n();
  const insets = useSafeAreaInsets();
  const {
    getToken,
    isLoaded: authIsLoaded,
    isSignedIn,
    sessionClaims,
  } = useAuth();
  const getTokenRef = useRef(getToken);
  const appStateRef = useRef(AppState.currentState);
  const suspendedAtRef = useRef<number | null>(
    /inactive|background/.test(AppState.currentState) ? Date.now() : null,
  );
  const lastForegroundResumeAtRef = useRef(0);
  const lastForegroundSessionRefreshAtRef = useRef(Date.now());
  const wasOfflineRef = useRef(isOffline);
  const preferredLanguageSyncKeyRef = useRef<string | null>(null);
  const previousPrivateLoadingOverlayDebugRef = useRef<string | null>(null);
  const [privateLoadingTimedOut, setPrivateLoadingTimedOut] = useState(false);
  const [isConnectionToastVisible, setIsConnectionToastVisible] =
    useState(false);
  const { signOut } = useClerk();
  const { user } = useUser();
  const { width: windowWidth } = useWindowDimensions();
  const shouldUseDesktopWebLayout =
    Platform.OS === "web" && windowWidth >= WEB_DESKTOP_MIN_WIDTH;
  const initialActiveTab = useMemo(() => getInitialFantasyTab(), []);
  const convexAuth = useConvexAuth();
  const upsertCurrentUser = useMutation(api.users.upsertCurrentUser);
  const deleteCurrentUserAccount = useAction(api.users.deleteCurrentUserAccount);
  const toggleFavoritePlayer = useMutation(api.fantasy.toggleFavoritePlayer);
  const upsertExpoPushToken = useMutation(
    api.notifications.upsertExpoPushToken,
  );

  const [activeTab, setActiveTab] = useState<FantasyTabId>(initialActiveTab);
  const [hasEnteredPrivateApp, setHasEnteredPrivateApp] = useState(false);
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<FantasyTabId>>(
    () => new Set(["team", "market", initialActiveTab]),
  );
  const [errorText, setErrorText] = useState<string | null>(null);
  const [convexTokenStatus, setConvexTokenStatus] =
    useState<ConvexTokenStatus>("idle");
  const [foregroundRefreshNonce, setForegroundRefreshNonce] = useState(0);
  const [canShowAuthProblem, setCanShowAuthProblem] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isAdminActionsOpen, setIsAdminActionsOpen] = useState(false);
  const [headerActionOverlay, setHeaderActionOverlay] =
    useState<HeaderActionOverlayConfig | null>(null);
  const [isShellHeaderHidden, setIsShellHeaderHidden] = useState(false);
  const [areBottomTabsHidden, setAreBottomTabsHidden] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [storedSeasonSlugLoaded, setStoredSeasonSlugLoaded] = useState(false);
  const [selectedSeasonSlug, setSelectedSeasonSlug] = useState<string | null>(
    null,
  );
  const [switchingSeasonSlug, setSwitchingSeasonSlug] = useState<string | null>(
    null,
  );
  const [isSeasonPickerOpen, setSeasonPickerOpen] = useState(false);

  const rawProfileName =
    user?.fullName ??
    getMetadataDisplayName(user?.unsafeMetadata) ??
    user?.username ??
    undefined;
  const currentAuthUserId = isSignedIn ? user?.id : undefined;
  const userIsSignedIn = authIsLoaded
    ? Boolean(isSignedIn)
    : hasEnteredPrivateApp;
  const preferDefaultToken = sessionClaims?.aud === "convex";
  const convexTokenReady = convexTokenStatus === "ready";
  const convexTokenFailed = convexTokenStatus === "failed";
  const hasAuthBootstrapProblem =
    userIsSignedIn &&
    (convexAuth.isLoading || !convexAuth.isAuthenticated || convexTokenFailed);
  const userCanUsePrivateFeatures =
    userIsSignedIn && convexAuth.isAuthenticated && convexTokenReady;
  const canUseNetworkedPrivateFeatures =
    userCanUsePrivateFeatures && !isOffline;
  const privateDataCacheKey = user?.id;
  const seasonDataCacheKey =
    user?.id && selectedSeasonSlug
      ? `${user.id}:${selectedSeasonSlug}`
      : undefined;
  const shouldQueryPrivateData = canUseNetworkedPrivateFeatures;
  const shouldQuerySeasonCatalog = shouldQueryPrivateData;
  const shouldQuerySelectedSeasonData =
    shouldQueryPrivateData && Boolean(selectedSeasonSlug);
  const selectedSeasonQueryArgs =
    shouldQuerySelectedSeasonData && selectedSeasonSlug
      ? { seasonSlug: selectedSeasonSlug }
      : "skip";
  const fantasySeasonsQuery = useSafeQuery(
    api.fantasy.listSeasons,
    shouldQuerySeasonCatalog ? {} : "skip",
  );
  const fantasyOverviewQuery = useSafeQuery(
    api.fantasy.overview,
    selectedSeasonQueryArgs,
  );
  const fantasyTeamQuery = useSafeQuery(
    api.fantasy.myTeam,
    selectedSeasonQueryArgs,
  );
  const fantasyPlayersQuery = useSafeQuery(
    api.fantasy.listPlayers,
    selectedSeasonQueryArgs,
  );
  const fantasyTeamsQuery = useSafeQuery(
    api.fantasy.listFantasyTeams,
    selectedSeasonQueryArgs,
  );
  const fantasyPrivateLeaguesQuery = useSafeQuery(
    api.fantasy.listMyPrivateLeagues,
    selectedSeasonQueryArgs,
  );
  const fantasyClubsQuery = useSafeQuery(
    api.fantasy.listClubs,
    selectedSeasonQueryArgs,
  );
  const fantasyGameweeksQuery = useSafeQuery(
    api.fantasy.listGameweeks,
    selectedSeasonQueryArgs,
  );
  const fantasyFixturesQuery = useSafeQuery(
    api.fantasy.listFixtures,
    selectedSeasonQueryArgs,
  );
  const seasonPlayerStatisticsQuery = useSafeQuery(
    api.fantasy.seasonPlayerStatistics,
    selectedSeasonQueryArgs,
  );
  const favoritePlayerIdsQuery = useSafeQuery(
    api.fantasy.myFavoritePlayerIds,
    selectedSeasonQueryArgs,
  );
  const selectedSeasonQueriesReady =
    !shouldQuerySelectedSeasonData ||
    (fantasyOverviewQuery !== undefined &&
      fantasyTeamQuery !== undefined &&
      fantasyPlayersQuery !== undefined &&
      fantasyTeamsQuery !== undefined &&
      fantasyPrivateLeaguesQuery !== undefined &&
      fantasyClubsQuery !== undefined &&
      fantasyGameweeksQuery !== undefined &&
      fantasyFixturesQuery !== undefined &&
      seasonPlayerStatisticsQuery !== undefined &&
      favoritePlayerIdsQuery !== undefined);
  const currentUserProfileQuery = useSafeQuery(
    api.users.me,
    shouldQueryPrivateData ? {} : "skip",
  );
  const notificationSummaryQuery = useSafeQuery(
    api.notifications.currentUserNotificationSummary,
    shouldQueryPrivateData ? {} : "skip",
  );
  const fantasySeasons = useLastDefinedValue(
    fantasySeasonsQuery,
    privateDataCacheKey,
  ) as FantasySeasonOption[] | undefined;
  const fantasyOverview = useLastDefinedValue(
    fantasyOverviewQuery,
    seasonDataCacheKey,
  );
  const fantasyTeam = useLastDefinedValue(
    fantasyTeamQuery,
    seasonDataCacheKey,
  );
  const fantasyPlayers = useLastDefinedValue(
    fantasyPlayersQuery,
    seasonDataCacheKey,
  );
  const fantasyTeams = useLastDefinedValue(
    fantasyTeamsQuery,
    seasonDataCacheKey,
  );
  const fantasyPrivateLeagues = useLastDefinedValue(
    fantasyPrivateLeaguesQuery,
    seasonDataCacheKey,
  );
  const fantasyClubs = useLastDefinedValue(
    fantasyClubsQuery,
    seasonDataCacheKey,
  );
  const fantasyGameweeks = useLastDefinedValue(
    fantasyGameweeksQuery,
    seasonDataCacheKey,
  );
  const fantasyFixtures = useLastDefinedValue(
    fantasyFixturesQuery,
    seasonDataCacheKey,
  );
  const seasonPlayerStatistics = useLastDefinedValue(
    seasonPlayerStatisticsQuery,
    seasonDataCacheKey,
  );
  const favoritePlayerIds = useLastDefinedValue(
    favoritePlayerIdsQuery,
    seasonDataCacheKey,
  );
  const currentUserProfile = useLastDefinedValue(
    currentUserProfileQuery,
    privateDataCacheKey,
  );
  const notificationSummary = useLastDefinedValue(
    notificationSummaryQuery,
    privateDataCacheKey,
  );
  const currentBackendUser = currentUserProfile?.user ?? null;
  const currentViewerIsAdmin = Boolean(currentUserProfile?.isAdmin);
  const currentViewerAccessResolved =
    !shouldQueryPrivateData || currentUserProfile !== undefined;
  const availableFantasySeasons = useMemo(
    () =>
      (fantasySeasons ?? []).map((season) => {
        const shouldLockForViewer =
          currentViewerAccessResolved &&
          !currentViewerIsAdmin &&
          isAdminOnlyFantasySeasonOption(season);
        const isLocked = Boolean(season.isLocked) || shouldLockForViewer;

        if (
          season.isLocked === isLocked &&
          (season.lockedReason ?? null) ===
            (isLocked ? (season.lockedReason ?? "coming_soon") : null)
        ) {
          return season;
        }

        return {
          ...season,
          accessLevel:
            season.accessLevel ??
            (isAdminOnlyFantasySeasonOption(season) ? "admin" : "public"),
          isLocked,
          lockedReason: isLocked
            ? (season.lockedReason ?? "coming_soon")
            : null,
        };
      }),
    [currentViewerAccessResolved, currentViewerIsAdmin, fantasySeasons],
  );
  const activeFantasySeason = useMemo(
    () =>
      selectedSeasonSlug
        ? (availableFantasySeasons.find(
            (season) => season.slug === selectedSeasonSlug,
          ) ?? null)
        : null,
    [availableFantasySeasons, selectedSeasonSlug],
  );
  const activeSeasonPrimaryColor =
    getFantasySeasonPrimaryColor(activeFantasySeason);
  const activeSeasonSoftColor =
    getFantasySeasonSoftColor(activeFantasySeason);
  const activeSeasonBorderColor = colorWithAlpha(
    activeSeasonPrimaryColor,
    0.32,
  );
  const localizedFantasyClubs = useMemo(
    () => localizeFantasyClubs(fantasyClubs, language),
    [fantasyClubs, language],
  );
  const localizedFantasyPlayers = useMemo(
    () =>
      localizeFantasyPlayers(fantasyPlayers, language, localizedFantasyClubs),
    [fantasyPlayers, language, localizedFantasyClubs],
  );
  const localizedActiveClubFantasyPlayers = useMemo(
    () =>
      localizedFantasyPlayers?.filter(
        (player) => player.clubId !== null && player.status !== "left",
      ),
    [localizedFantasyPlayers],
  );
  const localizedFantasyFixtures = useMemo(
    () =>
      localizeFantasyFixtures(fantasyFixtures, language, localizedFantasyClubs),
    [fantasyFixtures, language, localizedFantasyClubs],
  );
  const localizedFantasyGameweeks = useMemo(
    () => localizeFantasyGameweeks(fantasyGameweeks, language),
    [fantasyGameweeks, language],
  );
  const localizedFantasyTeam = useMemo(
    () => localizeFantasyTeam(fantasyTeam, language, localizedFantasyClubs),
    [fantasyTeam, language, localizedFantasyClubs],
  );

  useEffect(() => {
    void preloadFantasyStaticAssets().catch(() => undefined);
  }, []);

  useEffect(() => {
    let isCancelled = false;

    if (!authIsLoaded) {
      setStoredSeasonSlugLoaded(false);
      return undefined;
    }

    setSeasonPickerOpen(false);

    if (!currentAuthUserId) {
      setSelectedSeasonSlug(null);
      setStoredSeasonSlugLoaded(true);
      return undefined;
    }

    setStoredSeasonSlugLoaded(false);
    void getStoredFantasySeasonSlug().then((seasonSlug) => {
      if (isCancelled) return;
      setSelectedSeasonSlug(seasonSlug);
      setStoredSeasonSlugLoaded(true);
    });

    return () => {
      isCancelled = true;
    };
  }, [authIsLoaded, currentAuthUserId]);

  useEffect(() => {
    if (
      !storedSeasonSlugLoaded ||
      fantasySeasons === undefined ||
      !selectedSeasonSlug
    ) {
      return;
    }

    const selectedSeason = availableFantasySeasons.find(
      (season) => season.slug === selectedSeasonSlug,
    );
    if (!selectedSeason) {
      setSelectedSeasonSlug(null);
      setSwitchingSeasonSlug(null);
      void clearStoredFantasySeasonSlug();
      return;
    }
    if (
      selectedSeason.isLocked &&
      isAdminOnlyFantasySeasonOption(selectedSeason) &&
      !currentViewerAccessResolved
    ) {
      return;
    }
    if (selectedSeason.isLocked) {
      const fallbackSeasonSlug =
        availableFantasySeasons.find((season) => !season.isLocked)?.slug ??
        null;
      setSwitchingSeasonSlug(null);
      setErrorText(t("seasonSelection.comingSoonNotice"));
      setSelectedSeasonSlug(fallbackSeasonSlug);
      if (fallbackSeasonSlug) {
        void storeFantasySeasonSlug(fallbackSeasonSlug);
      } else {
        void clearStoredFantasySeasonSlug();
      }
    }
  }, [
    availableFantasySeasons,
    currentViewerAccessResolved,
    fantasySeasons,
    selectedSeasonSlug,
    storedSeasonSlugLoaded,
    t,
  ]);

  useEffect(() => {
    if (!activeFantasySeason || activeFantasySeason.isLocked) return;
    if (errorText === t("seasonSelection.comingSoonNotice")) {
      setErrorText(null);
    }
  }, [activeFantasySeason, errorText, t]);

  useEffect(() => {
    const currentGameweekNumber =
      fantasyOverview?.currentGameweek?.number ?? null;
    if (!currentGameweekNumber) {
      previousGameweekNumberRef.current = null;
      setDeadlineNoticeText(null);
      return;
    }

    const previousGameweekNumber = previousGameweekNumberRef.current;
    previousGameweekNumberRef.current = currentGameweekNumber;
    if (
      previousGameweekNumber === null ||
      currentGameweekNumber <= previousGameweekNumber
    ) {
      return;
    }

    setDeadlineNoticeText(
      t("team.deadlineRolloverNotice").replace(
        "{number}",
        String(currentGameweekNumber),
      ),
    );
    const timeoutId = setTimeout(() => setDeadlineNoticeText(null), 8000);
    return () => clearTimeout(timeoutId);
  }, [fantasyOverview?.currentGameweek?.number, t]);

  const profileName = rawProfileName
    ? formatPersonName(rawProfileName)
    : userIsSignedIn
      ? t("user.managerFallback")
      : t("user.guest");
  const profileEmail = user?.primaryEmailAddress?.emailAddress ?? undefined;
  const [deadlineNoticeText, setDeadlineNoticeText] = useState<string | null>(
    null,
  );
  const previousGameweekNumberRef = useRef<number | null>(null);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    if (authIsLoaded && isSignedIn) {
      clearPendingWebOAuthAttempt();
    }

    if (authIsLoaded && !isSignedIn) {
      setHasEnteredPrivateApp(false);
      setIsSigningOut(false);
    }
  }, [authIsLoaded, isSignedIn]);

  useEffect(() => {
    if (wasOfflineRef.current && !isOffline) {
      setCanShowAuthProblem(false);
      setConvexTokenStatus("idle");
      setPrivateLoadingTimedOut(false);
      setForegroundRefreshNonce((current) => current + 1);
    }

    wasOfflineRef.current = isOffline;
  }, [isOffline]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      const previousAppState = appStateRef.current;
      appStateRef.current = nextAppState;

      if (/inactive|background/.test(nextAppState)) {
        if (!/inactive|background/.test(previousAppState)) {
          suspendedAtRef.current = Date.now();
        }
        return;
      }

      if (
        nextAppState === "active" &&
        /inactive|background/.test(previousAppState)
      ) {
        const now = Date.now();
        const suspendedAt = suspendedAtRef.current;
        suspendedAtRef.current = null;
        lastForegroundResumeAtRef.current = now;
        setIsConnectionToastVisible(false);

        if (userIsSignedIn) {
          if (
            Platform.OS !== "web" &&
            suspendedAt &&
            now - suspendedAt < NATIVE_FOREGROUND_SESSION_REFRESH_GRACE_MS
          ) {
            return;
          }

          if (
            Platform.OS === "web" &&
            now - lastForegroundSessionRefreshAtRef.current <
              WEB_FOREGROUND_SESSION_REFRESH_COOLDOWN_MS
          ) {
            return;
          }

          lastForegroundSessionRefreshAtRef.current = now;
          setCanShowAuthProblem(false);
          setConvexTokenStatus("idle");
          setForegroundRefreshNonce((current) => current + 1);
        }
      }
    });

    return () => subscription.remove();
  }, [userIsSignedIn]);

  const previousAuthUserIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!authIsLoaded) return;
    if (previousAuthUserIdRef.current === currentAuthUserId) return;

    previousAuthUserIdRef.current = currentAuthUserId;
    const nextActiveTab = getInitialFantasyTab();
    setActiveTab(nextActiveTab);
    setVisitedTabs(new Set(["team", "market", nextActiveTab]));
    setIsNotificationsOpen(false);
    setHeaderActionOverlay(null);
    setIsShellHeaderHidden(false);
    setAreBottomTabsHidden(false);
    setSeasonPickerOpen(false);
    setCanShowAuthProblem(false);
    setConvexTokenStatus("idle");
    setPrivateLoadingTimedOut(false);
  }, [authIsLoaded, currentAuthUserId]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      return undefined;
    }

    const syncActiveTabFromUrl = () => {
      const nextTab = getFantasyTabFromWebPathname(window.location.pathname);
      if (nextTab) {
        setActiveTab(nextTab);
        setVisitedTabs((current) => {
          if (current.has(nextTab)) return current;

          const next = new Set(current);
          next.add(nextTab);
          return next;
        });
        return;
      }

      if (isUnknownFantasyWebTabPathname(window.location.pathname)) {
        window.history.replaceState(null, "", FANTASY_TAB_WEB_PATHS.team);
        setActiveTab("team");
        setVisitedTabs((current) => {
          if (current.has("team")) return current;

          const next = new Set(current);
          next.add("team");
          return next;
        });
      }
    };

    syncActiveTabFromUrl();
    window.addEventListener("popstate", syncActiveTabFromUrl);

    return () => {
      window.removeEventListener("popstate", syncActiveTabFromUrl);
    };
  }, []);

  useEffect(() => {
    if (activeTab !== "team") {
      setHeaderActionOverlay(null);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!switchingSeasonSlug) return;

    if (
      switchingSeasonSlug !== selectedSeasonSlug ||
      selectedSeasonQueriesReady ||
      !shouldQuerySelectedSeasonData
    ) {
      setSwitchingSeasonSlug(null);
    }
  }, [
    selectedSeasonQueriesReady,
    selectedSeasonSlug,
    shouldQuerySelectedSeasonData,
    switchingSeasonSlug,
  ]);

  useEffect(() => {
    if (!hasAuthBootstrapProblem) {
      setCanShowAuthProblem(false);
      return undefined;
    }

    const timeoutId = setTimeout(() => {
      setCanShowAuthProblem(true);
    }, CONVEX_AUTH_PROBLEM_GRACE_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [hasAuthBootstrapProblem]);

  useEffect(() => {
    if (
      !userIsSignedIn ||
      isOffline ||
      convexAuth.isLoading ||
      !convexAuth.isAuthenticated
    ) {
      setConvexTokenStatus((current) => {
        if (isOffline && current === "ready") {
          return current;
        }

        return current === "idle" ? current : "idle";
      });
      return;
    }

    let cancelled = false;
    setConvexTokenStatus((current) =>
      current === "loading" ? current : "loading",
    );

    const warmUpConvexToken = async () => {
      const tokenRequests = preferDefaultToken
        ? [{}, { template: "convex" as const }]
        : [{ template: "convex" as const }, {}];
      const startedAt = Date.now();
      const hasWarmupTimedOut = () =>
        Date.now() - startedAt >= CONVEX_TOKEN_WARMUP_TOTAL_TIMEOUT_MS;

      warmupAttempts: for (
        let attempt = 0;
        attempt < CONVEX_TOKEN_WARMUP_ATTEMPTS;
        attempt += 1
      ) {
        if (hasWarmupTimedOut()) break;

        for (const request of tokenRequests) {
          if (hasWarmupTimedOut()) break warmupAttempts;

          try {
            const token = await withTimeout(
              getTokenRef.current(request),
              TOKEN_FETCH_TIMEOUT_MS,
            );
            if (token) {
              if (!cancelled) {
                setConvexTokenStatus("ready");
              }
              return;
            }
          } catch {
            // Clerk may need a short moment after OAuth before every token variant is available.
          }
        }

        if (cancelled) return;
        if (hasWarmupTimedOut()) break;
        await wait(CONVEX_TOKEN_WARMUP_DELAY_MS);
      }

      if (!cancelled) {
        setConvexTokenStatus("failed");
      }
    };

    void warmUpConvexToken();

    return () => {
      cancelled = true;
    };
  }, [
    convexAuth.isAuthenticated,
    convexAuth.isLoading,
    foregroundRefreshNonce,
    isOffline,
    preferDefaultToken,
    userIsSignedIn,
  ]);

  useDismissKeyboardOnChange([
    activeTab,
    isNotificationsOpen,
    isAdminActionsOpen,
    isShellHeaderHidden,
    areBottomTabsHidden,
    isSeasonPickerOpen,
  ]);

  const clearError = useCallback(() => setErrorText(null), []);
  const setAsyncError = useCallback(
    (message: string) => setErrorText(message),
    [],
  );
  const handleTabChange = useCallback((nextTab: FantasyTabId) => {
    Keyboard.dismiss();
    setIsAdminActionsOpen(false);
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const nextPathname = FANTASY_TAB_WEB_PATHS[nextTab];
      if (
        normalizeFantasyWebPathname(window.location.pathname) !== nextPathname
      ) {
        window.history.pushState(null, "", nextPathname);
      }
    }
    setVisitedTabs((current) => {
      if (current.has(nextTab)) return current;

      const next = new Set(current);
      next.add(nextTab);
      return next;
    });
    setActiveTab(nextTab);
  }, []);

  const handleSelectFantasySeason = useCallback(
    (season: FantasySeasonOption) => {
      Keyboard.dismiss();
      setErrorText(null);
      if (season.isLocked) {
        setErrorText(t("seasonSelection.comingSoonNotice"));
        setSeasonPickerOpen(false);
        return;
      }

      const seasonSlug = season.slug;
      if (seasonSlug === selectedSeasonSlug) {
        setSeasonPickerOpen(false);
        return;
      }
      if (selectedSeasonSlug) {
        setSwitchingSeasonSlug(seasonSlug);
      }
      setSelectedSeasonSlug(seasonSlug);
      setSeasonPickerOpen(false);

      if (!selectedSeasonSlug) {
        handleTabChange("team");
      }

      void storeFantasySeasonSlug(seasonSlug);
    },
    [handleTabChange, selectedSeasonSlug, t],
  );

  const handleOpenAdminActions = useCallback(() => {
    Keyboard.dismiss();
    setIsAdminActionsOpen(true);
  }, []);

  const handleCloseAdminActions = useCallback(() => {
    Keyboard.dismiss();
    setIsAdminActionsOpen(false);
  }, []);

  const profileReady = useCurrentUserBootstrap({
    onError: setAsyncError,
    onStart: clearError,
    preferredLanguage: language,
    profileEmail,
    profileName,
    upsertCurrentUser,
    userId: canUseNetworkedPrivateFeatures ? user?.id : undefined,
  });

  const shouldWaitForCurrentUserProfile =
    userCanUsePrivateFeatures &&
    profileReady &&
    currentUserProfile === undefined;
  const canResolveSeasonSelection = Boolean(
    userCanUsePrivateFeatures && profileReady && currentBackendUser,
  );
  const shouldWaitForSeasonSelection = Boolean(
    canResolveSeasonSelection &&
      (!storedSeasonSlugLoaded || fantasySeasons === undefined),
  );
  const shouldRequireSeasonSelection = Boolean(
    canResolveSeasonSelection &&
      storedSeasonSlugLoaded &&
      fantasySeasons !== undefined &&
      !activeFantasySeason,
  );

  useEffect(() => {
    if (userCanUsePrivateFeatures && profileReady) {
      setHasEnteredPrivateApp(true);
    }
  }, [profileReady, userCanUsePrivateFeatures]);

  useEffect(() => {
    if (!userIsSignedIn) {
      preferredLanguageSyncKeyRef.current = null;
    }
  }, [userIsSignedIn]);

  useEffect(() => {
    if (authIsLoaded && isSigningOut && !userIsSignedIn) {
      setIsSigningOut(false);
    }
  }, [authIsLoaded, isSigningOut, userIsSignedIn]);

  useEffect(() => {
    if (!isOffline) {
      setIsConnectionToastVisible(false);
      return undefined;
    }

    const resumedAgoMs = Date.now() - lastForegroundResumeAtRef.current;
    const showDelayMs = Math.max(
      CONNECTION_TOAST_RESUME_GRACE_MS - resumedAgoMs,
      0,
    );
    let hideTimeoutId: ReturnType<typeof setTimeout> | undefined;
    const showTimeoutId = setTimeout(() => {
      setIsConnectionToastVisible(true);
      hideTimeoutId = setTimeout(() => {
        setIsConnectionToastVisible(false);
      }, CONNECTION_TOAST_DURATION_MS);
    }, showDelayMs);

    return () => {
      clearTimeout(showTimeoutId);
      if (hideTimeoutId) {
        clearTimeout(hideTimeoutId);
      }
    };
  }, [isOffline]);

  useEffect(() => {
    if (
      !canUseNetworkedPrivateFeatures ||
      !profileReady ||
      !currentBackendUser
    ) {
      return undefined;
    }

    const syncKey = `${currentBackendUser.clerkId}:${language}`;
    if (currentBackendUser.preferredLanguage === language) {
      preferredLanguageSyncKeyRef.current = syncKey;
      return undefined;
    }

    if (preferredLanguageSyncKeyRef.current === syncKey) {
      return undefined;
    }

    const timeoutId = setTimeout(() => {
      preferredLanguageSyncKeyRef.current = syncKey;
      void upsertCurrentUser({
        email: profileEmail,
        name: profileName,
        preferredLanguage: language,
      }).catch(() => {
        if (preferredLanguageSyncKeyRef.current === syncKey) {
          preferredLanguageSyncKeyRef.current = null;
        }
      });
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [
    canUseNetworkedPrivateFeatures,
    currentBackendUser,
    language,
    profileEmail,
    profileName,
    profileReady,
    upsertCurrentUser,
  ]);

  useExpoPushTokenRegistration({
    enabled: canUseNetworkedPrivateFeatures && profileReady,
    upsertExpoPushToken,
  });

  const handleToggleFavoritePlayer = useCallback(
    (playerId: Id<"fantasyPlayers">, isFavorite: boolean) => {
      const mutationArgs = selectedSeasonSlug
        ? { isFavorite, playerId, seasonSlug: selectedSeasonSlug }
        : { isFavorite, playerId };
      void toggleFavoritePlayer(mutationArgs).catch(
        (error: unknown) => {
          setAsyncError(getErrorMessage(error, language));
        },
      );
    },
    [language, selectedSeasonSlug, setAsyncError, toggleFavoritePlayer],
  );

  const isLeagueTabActive = activeTab === "league";
  const isTeamTabActive = activeTab === "team";
  const isMarketTabActive = activeTab === "market";
  const isSeasonTabActive = activeTab === "season";
  const isProfileTabActive = activeTab === "profile";
  const leagueTabWasVisited = visitedTabs.has("league");
  const marketTabWasVisited = visitedTabs.has("market");
  const seasonTabWasVisited = visitedTabs.has("season");
  const profileTabWasVisited = visitedTabs.has("profile");

  const handleSignOut = useCallback(async () => {
    if (isSigningOut) return;

    try {
      setErrorText(null);
      setIsSigningOut(true);
      await waitForNextPaint();
      await clearStoredLegalAcceptance();
      if (Platform.OS === "web") {
        await (
          signOut as (options?: { redirectUrl?: string }) => Promise<void>
        )({
          redirectUrl: getWebAppRedirectUrl(),
        });
        keepBrowserOnWebAppPath();
      } else {
        await signOut();
      }
    } catch (error) {
      setIsSigningOut(false);
      setAsyncError(getErrorMessage(error, language));
    }
  }, [isSigningOut, language, setAsyncError, signOut]);

  const handleDeleteAccount = useCallback(async () => {
    await deleteCurrentUserAccount({});
    setErrorText(null);
    setIsSigningOut(true);
    await waitForNextPaint();
    await clearStoredLegalAcceptance();

    try {
      if (Platform.OS === "web") {
        await (
          signOut as (options?: { redirectUrl?: string }) => Promise<void>
        )({
          redirectUrl: getWebAppRedirectUrl(),
        });
        keepBrowserOnWebAppPath();
      } else {
        await signOut();
      }
    } catch (error) {
      console.warn("[auth:deleteAccountSignOut]", error);
      if (Platform.OS === "web") {
        keepBrowserOnWebAppPath();
      }
    }
  }, [deleteCurrentUserAccount, signOut]);

  const leagueScreen = useMemo(
    () => (
      <LeagueScreen
        canQueryPrivateData={shouldQueryPrivateData}
        clubs={localizedFantasyClubs}
        currentFantasyTeamId={
          localizedFantasyTeam?.id
            ? (localizedFantasyTeam.id as Id<"fantasyTeams">)
            : null
        }
        gameweeks={localizedFantasyGameweeks}
        isAdmin={Boolean(currentUserProfile?.isAdmin)}
        onBottomTabsHiddenChange={setAreBottomTabsHidden}
        onShellHeaderHiddenChange={setIsShellHeaderHidden}
        privateLeagues={fantasyPrivateLeagues}
        seasonSlug={selectedSeasonSlug}
        teams={fantasyTeams}
      />
    ),
    [
      currentUserProfile?.isAdmin,
      fantasyTeams,
      fantasyPrivateLeagues,
      localizedFantasyClubs,
      localizedFantasyGameweeks,
      localizedFantasyTeam?.id,
      selectedSeasonSlug,
      shouldQueryPrivateData,
    ],
  );
  const teamScreen = useMemo(
    () => (
      <MyTeamScreen
        canQueryPrivateData={shouldQueryPrivateData}
        fantasyClubs={localizedFantasyClubs}
        fantasyOverview={fantasyOverview}
        fantasyPlayers={localizedActiveClubFantasyPlayers}
        fantasyTeam={localizedFantasyTeam}
        fantasyTeams={fantasyTeams}
        fantasySeason={activeFantasySeason}
        fantasyGameweeks={localizedFantasyGameweeks}
        isActive={isTeamTabActive}
        managerName={profileName}
        onBottomTabsHiddenChange={setAreBottomTabsHidden}
        onHeaderActionOverlayChange={setHeaderActionOverlay}
        onShellHeaderHiddenChange={setIsShellHeaderHidden}
        onTopEdgeToEdgeChange={onTopEdgeToEdgeChange}
      />
    ),
    [
      fantasyOverview,
      localizedFantasyClubs,
      localizedActiveClubFantasyPlayers,
      localizedFantasyTeam,
      fantasyTeams,
      localizedFantasyGameweeks,
      isTeamTabActive,
      profileName,
      setAreBottomTabsHidden,
      setIsShellHeaderHidden,
      onTopEdgeToEdgeChange,
      shouldQueryPrivateData,
    ],
  );
  const marketScreen = useMemo(
    () => (
      <MarketScreen
        clubs={localizedFantasyClubs}
        favoritePlayerIds={favoritePlayerIds}
        onToggleFavorite={handleToggleFavoritePlayer}
        players={localizedActiveClubFantasyPlayers}
      />
    ),
    [
      localizedFantasyClubs,
      localizedActiveClubFantasyPlayers,
      favoritePlayerIds,
      handleToggleFavoritePlayer,
    ],
  );
  const seasonScreen = useMemo(
    () => (
      <SeasonScreen
        clubs={localizedFantasyClubs}
        fixtures={localizedFantasyFixtures}
        gameweeks={localizedFantasyGameweeks}
        playerStatistics={seasonPlayerStatistics}
      />
    ),
    [
      localizedFantasyClubs,
      localizedFantasyFixtures,
      localizedFantasyGameweeks,
      seasonPlayerStatistics,
    ],
  );
  const profileScreen = useMemo(
    () => (
      <ProfileScreen
        canQueryPrivateData={shouldQueryPrivateData}
        email={profileEmail}
        fixtures={localizedFantasyFixtures}
        gameweeks={localizedFantasyGameweeks}
        isAdmin={Boolean(currentUserProfile?.isAdmin)}
        name={profileName}
        onDeleteAccount={handleDeleteAccount}
        onOpenAdminActions={handleOpenAdminActions}
        onSignOut={handleSignOut}
        players={localizedActiveClubFantasyPlayers}
        seasonSlug={selectedSeasonSlug}
      />
    ),
    [
      currentUserProfile?.isAdmin,
      shouldQueryPrivateData,
      localizedFantasyGameweeks,
      handleDeleteAccount,
      handleOpenAdminActions,
      handleSignOut,
      localizedFantasyFixtures,
      localizedActiveClubFantasyPlayers,
      profileEmail,
      profileName,
      selectedSeasonSlug,
    ],
  );

  const privateLoadingOverlayReason =
    hasEnteredPrivateApp && userIsSignedIn && isSigningOut
      ? "signingOut"
      : hasEnteredPrivateApp &&
          userIsSignedIn &&
          !isOffline &&
          hasAuthBootstrapProblem &&
          !canShowAuthProblem
        ? "authBootstrap"
        : null;
  const privateLoadingOverlayTitle =
    privateLoadingOverlayReason === "signingOut"
      ? t("loading.signingOut")
      : privateLoadingOverlayReason === "authBootstrap"
        ? t("loading.oauthComplete")
        : null;
  const privateLoadingOverlayDebugKey = privateLoadingOverlayReason
    ? JSON.stringify({
        reason: privateLoadingOverlayReason,
        authIsLoaded,
        canShowAuthProblem,
        convexAuthIsAuthenticated: convexAuth.isAuthenticated,
        convexAuthIsLoading: convexAuth.isLoading,
        convexTokenStatus,
        foregroundRefreshNonce,
        hasEnteredPrivateApp,
        isOffline,
        profileReady,
        shouldWaitForCurrentUserProfile,
        userCanUsePrivateFeatures,
        userIsSignedIn,
      })
    : null;

  useEffect(() => {
    if (!privateLoadingOverlayReason) {
      setPrivateLoadingTimedOut(false);
      return undefined;
    }

    setPrivateLoadingTimedOut(false);
    const timeoutId = setTimeout(() => {
      setPrivateLoadingTimedOut(true);
    }, PRIVATE_LOADING_OVERLAY_TIMEOUT_MS);

    return () => clearTimeout(timeoutId);
  }, [foregroundRefreshNonce, privateLoadingOverlayReason]);

  useEffect(() => {
    if (!__DEV__) return;
    if (
      previousPrivateLoadingOverlayDebugRef.current ===
      privateLoadingOverlayDebugKey
    ) {
      return;
    }

    previousPrivateLoadingOverlayDebugRef.current =
      privateLoadingOverlayDebugKey;

    if (!privateLoadingOverlayDebugKey) return;

    console.log(
      "[FantasyHome] loading overlay",
      JSON.parse(privateLoadingOverlayDebugKey),
    );
  }, [privateLoadingOverlayDebugKey]);

  if (isSigningOut) {
    return (
      <AppLoadingScreen
        title={t("loading.signingOut")}
        description={t("loading.syncingAccount")}
      />
    );
  }

  if (!authIsLoaded && !hasEnteredPrivateApp) {
    if (isOffline) {
      return <AppConnectionProblemScreen />;
    }

    return (
      <AppLoadingScreen
        title={t("loading.checkingSession")}
        description={t("loading.syncingAccount")}
      />
    );
  }

  if (shouldWaitForCurrentUserProfile && !hasEnteredPrivateApp) {
    if (isOffline) {
      return <AppConnectionProblemScreen />;
    }

    return (
      <AppLoadingScreen
        title={t("loading.preparingProfile")}
        description={t("loading.syncingAccount")}
      />
    );
  }

  if (!userIsSignedIn) {
    return <AuthScreen title={t("auth.welcomeTitle")} />;
  }

  if (isOffline && !hasEnteredPrivateApp && !userCanUsePrivateFeatures) {
    return <AppConnectionProblemScreen />;
  }

  if (
    userIsSignedIn &&
    !hasEnteredPrivateApp &&
    ((convexAuth.isLoading && !canShowAuthProblem) ||
      (!convexAuth.isAuthenticated && !canShowAuthProblem) ||
      (convexAuth.isAuthenticated && !convexTokenReady && !canShowAuthProblem))
  ) {
    if (isOffline) {
      return <AppConnectionProblemScreen />;
    }

    return (
      <AppLoadingScreen
        title={t("loading.oauthComplete")}
        description={t("loading.syncingAccount")}
      />
    );
  }

  if (userCanUsePrivateFeatures && !profileReady && !hasEnteredPrivateApp) {
    if (isOffline) {
      return <AppConnectionProblemScreen />;
    }

    return (
      <AppLoadingScreen
        title={t("loading.preparingProfile")}
        description={t("loading.syncingAccount")}
      />
    );
  }

  if (shouldWaitForSeasonSelection && !hasEnteredPrivateApp) {
    if (isOffline) {
      return <AppConnectionProblemScreen />;
    }

    return (
      <AppLoadingScreen
        title={t("seasonSelection.loadingTitle")}
        description={t("seasonSelection.loadingDescription")}
      />
    );
  }

  const authProblemText =
    hasAuthBootstrapProblem && canShowAuthProblem
      ? t("session.authProblem")
      : null;
  const sessionRestoreProblemText =
    privateLoadingTimedOut &&
    privateLoadingOverlayReason &&
    privateLoadingOverlayReason !== "signingOut"
      ? t("session.restoreProblem")
      : null;
  const connectionToastText =
    isOffline && isConnectionToastVisible
      ? t("network.offlineDescription")
      : null;
  const shouldShowSeasonSwitchOverlay = Boolean(
    switchingSeasonSlug &&
      switchingSeasonSlug === selectedSeasonSlug &&
      !selectedSeasonQueriesReady &&
      !isOffline,
  );
  const inlineMessageText =
    errorText ??
    authProblemText ??
    sessionRestoreProblemText ??
    deadlineNoticeText;
  const inlineMessageStyle =
    deadlineNoticeText && inlineMessageText === deadlineNoticeText
      ? [
          styles.fantasyInlineMessage,
          styles.fantasyInlineMessageInfo,
          {
            backgroundColor: activeSeasonSoftColor,
            borderColor: activeSeasonBorderColor,
          },
        ]
      : styles.fantasyInlineMessage;
  const inlineMessageTextStyle =
    deadlineNoticeText && inlineMessageText === deadlineNoticeText
      ? [
          styles.fantasyInlineMessageInfoText,
          { color: activeSeasonPrimaryColor },
        ]
      : styles.errorText;

  if (shouldShowSeasonSwitchOverlay) {
    return (
      <AppLoadingScreen
        title={t("seasonSelection.loadingTitle")}
        description={t("seasonSelection.loadingDescription")}
      />
    );
  }

  if (authProblemText) {
    return (
      <FantasySeasonThemeProvider season={activeFantasySeason}>
        <View style={styles.fantasyShell}>
          <FantasyShellHeader
            activeSeason={activeFantasySeason}
            activeTab={activeTab}
            onNotificationsPress={() => setIsNotificationsOpen(true)}
            onSeasonSelectPress={() => setSeasonPickerOpen(true)}
            onTabChange={handleTabChange}
            seasonOptions={availableFantasySeasons}
            showLanguageSwitcher={shouldUseDesktopWebLayout}
            showWebNav={false}
            tabs={FANTASY_TABS}
          />

          <View style={styles.fantasyInlineMessage}>
            <Text style={styles.errorText}>{authProblemText}</Text>
          </View>

          <View style={styles.fantasyScreen}>
            <View style={styles.panel}>
              <Text style={styles.sectionTitle}>{profileName}</Text>
              <Text style={styles.mutedText}>
                {profileEmail ?? t("profile.noEmail")}
              </Text>
              <Pressable
                onPress={() => void handleSignOut()}
                style={[
                  styles.secondaryButton,
                  { borderColor: activeSeasonBorderColor },
                ]}
              >
                <Text
                  style={[
                    styles.secondaryButtonText,
                    { color: activeSeasonPrimaryColor },
                  ]}
                >
                  {t("profile.signOut")}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </FantasySeasonThemeProvider>
    );
  }

  if (shouldWaitForSeasonSelection) {
    if (isOffline) {
      return <AppConnectionProblemScreen />;
    }

    return (
      <AppLoadingScreen
        title={t("seasonSelection.loadingTitle")}
        description={t("seasonSelection.loadingDescription")}
      />
    );
  }

  if (shouldRequireSeasonSelection) {
    return (
      <FantasySeasonThemeProvider season={activeFantasySeason}>
        <View style={styles.fantasyShell}>
          <FantasyStaticImagePreloader />
          <FantasyShellHeader
            activeSeason={activeFantasySeason}
            activeTab={activeTab}
            onNotificationsPress={() => setIsNotificationsOpen(true)}
            onSeasonSelectPress={() => setSeasonPickerOpen(true)}
            onTabChange={handleTabChange}
            seasonOptions={availableFantasySeasons}
            showLanguageSwitcher={shouldUseDesktopWebLayout}
            showWebNav={false}
            tabs={FANTASY_TABS}
            unreadNotificationsCount={notificationSummary?.unreadCount ?? 0}
          />
          {inlineMessageText ? (
            <View style={inlineMessageStyle}>
              <Text style={inlineMessageTextStyle}>{inlineMessageText}</Text>
            </View>
          ) : null}
          <FantasySeasonSelectionScreen
            onSelect={handleSelectFantasySeason}
            seasons={availableFantasySeasons}
          />
        </View>
      </FantasySeasonThemeProvider>
    );
  }

  if (isNotificationsOpen) {
    return (
      <FantasySeasonThemeProvider season={activeFantasySeason}>
        <NotificationsScreen onBack={() => setIsNotificationsOpen(false)} />
      </FantasySeasonThemeProvider>
    );
  }

  if (isAdminActionsOpen) {
    return (
      <FantasySeasonThemeProvider season={activeFantasySeason}>
        <ProfileScreen
          canQueryPrivateData={shouldQueryPrivateData}
          email={profileEmail}
          fixtures={localizedFantasyFixtures}
          gameweeks={localizedFantasyGameweeks}
          isAdmin={Boolean(currentUserProfile?.isAdmin)}
          mode="adminActions"
          name={profileName}
          onAdminActionsBack={handleCloseAdminActions}
          onDeleteAccount={handleDeleteAccount}
          onOpenAdminActions={handleOpenAdminActions}
          onSignOut={handleSignOut}
          players={localizedActiveClubFantasyPlayers}
          seasonSlug={selectedSeasonSlug}
        />
      </FantasySeasonThemeProvider>
    );
  }

  return (
    <FantasySeasonThemeProvider season={activeFantasySeason}>
      <View style={styles.fantasyShell}>
        <FantasyStaticImagePreloader />
        {isShellHeaderHidden ? null : (
          <FantasyShellHeader
            activeSeason={activeFantasySeason}
            activeTab={activeTab}
            onNotificationsPress={() => setIsNotificationsOpen(true)}
            onSeasonSelectPress={() => setSeasonPickerOpen(true)}
            onTabChange={handleTabChange}
            seasonOptions={availableFantasySeasons}
            showLanguageSwitcher={shouldUseDesktopWebLayout}
            showWebNav={shouldUseDesktopWebLayout}
            tabs={FANTASY_TABS}
            unreadNotificationsCount={notificationSummary?.unreadCount ?? 0}
          />
        )}
      <HeaderActionOverlay config={headerActionOverlay} />

      {connectionToastText ? (
        <View
          pointerEvents="none"
          style={[
            styles.fantasyConnectionToast,
            isShellHeaderHidden ? { top: insets.top + spacing.md } : null,
          ]}
        >
          <Text style={styles.fantasyConnectionToastText}>
            {connectionToastText}
          </Text>
        </View>
      ) : null}

      {inlineMessageText ? (
        <View style={inlineMessageStyle}>
          <Text style={inlineMessageTextStyle}>{inlineMessageText}</Text>
        </View>
      ) : null}

      <View style={styles.fantasyContent}>
        <View
          pointerEvents={isLeagueTabActive ? "auto" : "none"}
          style={[
            styles.fantasyCachedTabPanel,
            isLeagueTabActive ? null : styles.fantasyCachedTabPanelHidden,
          ]}
        >
          {leagueTabWasVisited ? leagueScreen : null}
        </View>
        <View
          pointerEvents={isTeamTabActive ? "auto" : "none"}
          style={[
            styles.fantasyCachedTabPanel,
            isTeamTabActive ? null : styles.fantasyCachedTabPanelHidden,
          ]}
        >
          {teamScreen}
        </View>
        <View
          pointerEvents={isMarketTabActive ? "auto" : "none"}
          style={[
            styles.fantasyCachedTabPanel,
            isMarketTabActive ? null : styles.fantasyCachedTabPanelHidden,
          ]}
        >
          {marketTabWasVisited ? marketScreen : null}
        </View>
        <View
          pointerEvents={isSeasonTabActive ? "auto" : "none"}
          style={[
            styles.fantasyCachedTabPanel,
            isSeasonTabActive ? null : styles.fantasyCachedTabPanelHidden,
          ]}
        >
          {seasonTabWasVisited ? seasonScreen : null}
        </View>
        <View
          pointerEvents={isProfileTabActive ? "auto" : "none"}
          style={[
            styles.fantasyCachedTabPanel,
            isProfileTabActive ? null : styles.fantasyCachedTabPanelHidden,
          ]}
        >
          {profileTabWasVisited ? profileScreen : null}
        </View>
      </View>

      {areBottomTabsHidden || shouldUseDesktopWebLayout ? null : (
      <FantasyBottomTabs
          activeColor={getFantasySeasonPrimaryColor(activeFantasySeason)}
          activeBackgroundColor={getFantasySeasonSoftColor(activeFantasySeason)}
          activeTab={activeTab}
          onChange={handleTabChange}
          tabs={FANTASY_TABS}
        />
      )}

      <FantasySeasonPickerSheet
        activeSeasonSlug={selectedSeasonSlug}
        onClose={() => setSeasonPickerOpen(false)}
        onSelect={handleSelectFantasySeason}
        seasons={availableFantasySeasons}
        visible={isSeasonPickerOpen}
      />

      {privateLoadingOverlayTitle && !privateLoadingTimedOut ? (
        Platform.OS === "web" ? (
          <AppLoadingScreen
            title={privateLoadingOverlayTitle}
            description={t("loading.syncingAccount")}
          />
        ) : (
          <AppLoadingOverlay title={privateLoadingOverlayTitle} />
        )
      ) : null}
      </View>
    </FantasySeasonThemeProvider>
  );
}
