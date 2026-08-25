"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type GeoPoint = {
  latitude: number;
  longitude: number;
};

type BusStop = GeoPoint & {
  id: string;
  name: string;
  description: string;
};

type UserPosition = GeoPoint & {
  accuracy: number;
};

type LocationStatus =
  | "idle"
  | "locating"
  | "tracking"
  | "denied"
  | "unavailable"
  | "unsupported";

type LookupStatus = "idle" | "loading" | "ready" | "empty" | "error";
type StopSource = "dataset" | "demo" | null;

type NearbyStopsResponse = {
  stops: BusStop[];
  source: "dataset";
  radiusMeters: number;
};

const DEMO_STOP: BusStop = {
  id: "demo:seoul-station-transfer",
  name: "서울역버스환승센터",
  description: "정류장 근처 상황을 보여주는 데모예요",
  latitude: 37.55531,
  longitude: 126.97231,
};

const ENTER_RADIUS_METERS = 120;
const EXIT_RADIUS_METERS = 170;
const MAX_ACCEPTABLE_ACCURACY_METERS = 80;
const LOOKUP_DISTANCE_METERS = 100;
const LOOKUP_INTERVAL_MS = 60_000;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

const getDistanceInMeters = (from: GeoPoint, to: GeoPoint) => {
  const earthRadius = 6_371_000;
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);

  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  const clampedHaversine = Math.min(1, Math.max(0, haversine));

  return (
    earthRadius *
    2 *
    Math.atan2(Math.sqrt(clampedHaversine), Math.sqrt(1 - clampedHaversine))
  );
};

const formatDistance = (distance: number) => {
  if (distance < 1_000) return Math.round(distance) + "m";
  return (distance / 1_000).toFixed(1) + "km";
};

export default function Home() {
  const [locationStatus, setLocationStatus] = useState<LocationStatus>("idle");
  const [lookupStatus, setLookupStatus] = useState<LookupStatus>("idle");
  const [position, setPosition] = useState<UserPosition | null>(null);
  const [busStops, setBusStops] = useState<BusStop[]>([]);
  const [stopSource, setStopSource] = useState<StopSource>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [hasFoundClover, setHasFoundClover] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);

  const watchIdRef = useRef<number | null>(null);
  const lookupAbortRef = useRef<AbortController | null>(null);
  const lastLookupRef = useRef<{
    position: GeoPoint;
    requestedAt: number;
  } | null>(null);
  const presentedStopRef = useRef<BusStop | null>(null);

  const nearestStop = useMemo(() => {
    if (!position || busStops.length === 0) return null;

    return busStops.reduce<{ stop: BusStop; distance: number } | null>(
      (nearest, stop) => {
        const distance = getDistanceInMeters(position, stop);
        if (!nearest || distance < nearest.distance) return { stop, distance };
        return nearest;
      },
      null,
    );
  }, [busStops, position]);

  const clearActiveWatch = useCallback(() => {
    if (watchIdRef.current !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  /** 주변 정류장 조회 */
  const lookupNearbyStops = useCallback(
    async (nextPosition: UserPosition, force = false) => {
      const lastLookup = lastLookupRef.current;
      const movedDistance = lastLookup
        ? getDistanceInMeters(lastLookup.position, nextPosition)
        : Number.POSITIVE_INFINITY;
      const elapsedTime = lastLookup
        ? Date.now() - lastLookup.requestedAt
        : Number.POSITIVE_INFINITY;

      if (
        !force &&
        movedDistance < LOOKUP_DISTANCE_METERS &&
        elapsedTime < LOOKUP_INTERVAL_MS
      ) {
        return;
      }

      lookupAbortRef.current?.abort();
      const controller = new AbortController();
      lookupAbortRef.current = controller;
      lastLookupRef.current = {
        position: nextPosition,
        requestedAt: Date.now(),
      };

      setLookupStatus("loading");
      setBusStops([]);
      setStopSource(null);

      try {
        const response = await fetch("/api/bus-stops", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            latitude: nextPosition.latitude,
            longitude: nextPosition.longitude,
          }),
          signal: controller.signal,
        });

        if (!response.ok) throw new Error("Nearby stop lookup failed");

        console.log(`Nearby stop lookup response: ${response.status}`);

        const data = (await response.json()) as NearbyStopsResponse;
        if (controller.signal.aborted) return;

        setBusStops(data.stops);
        setStopSource(data.source);
        setLookupStatus(data.stops.length > 0 ? "ready" : "empty");
      } catch {
        if (controller.signal.aborted) return;
        lastLookupRef.current = null;
        setBusStops([]);
        setStopSource(null);
        setLookupStatus("error");
      }
    },
    [],
  );

  const updateLivePosition = useCallback(
    (nextPosition: UserPosition) => {
      setPosition(nextPosition);
      setLocationStatus("tracking");
      void lookupNearbyStops(nextPosition);
    },
    [lookupNearbyStops],
  );

  const resetNearbyState = useCallback(() => {
    lookupAbortRef.current?.abort();
    lookupAbortRef.current = null;
    lastLookupRef.current = null;
    presentedStopRef.current = null;
    setLookupStatus("idle");
    setBusStops([]);
    setStopSource(null);
    setPosition(null);
    setIsModalOpen(false);
  }, []);

  const startTracking = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setLocationStatus("unsupported");
      return;
    }

    console.log("Starting geolocation tracking...");

    clearActiveWatch();
    resetNearbyState();
    setLocationStatus("locating");
    setHasFoundClover(false);
    setIsDemoMode(false);

    watchIdRef.current = navigator.geolocation.watchPosition(
      ({ coords }) => {
        updateLivePosition({
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy,
        });
      },
      (error) => {
        watchIdRef.current = null;
        setLocationStatus(
          error.code === error.PERMISSION_DENIED ? "denied" : "unavailable",
        );
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5_000,
        timeout: 12_000,
      },
    );
  }, [clearActiveWatch, resetNearbyState, updateLivePosition]);

  const stopTracking = useCallback(() => {
    clearActiveWatch();
    resetNearbyState();
    setLocationStatus("idle");
    setIsDemoMode(false);
  }, [clearActiveWatch, resetNearbyState]);

  const tryDemoLocation = useCallback(() => {
    clearActiveWatch();
    resetNearbyState();
    setIsDemoMode(true);
    setLocationStatus("tracking");
    setLookupStatus("ready");
    setBusStops([DEMO_STOP]);
    setStopSource("demo");
    setPosition({
      latitude: DEMO_STOP.latitude + 0.00018,
      longitude: DEMO_STOP.longitude,
      accuracy: 8,
    });
  }, [clearActiveWatch, resetNearbyState]);

  useEffect(() => {
    return () => {
      clearActiveWatch();
      lookupAbortRef.current?.abort();
    };
  }, [clearActiveWatch]);

  useEffect(() => {
    if (!position) return;

    const presentedStop = presentedStopRef.current;
    if (presentedStop) {
      const distanceFromPresentedStop = getDistanceInMeters(
        position,
        presentedStop,
      );

      if (distanceFromPresentedStop <= EXIT_RADIUS_METERS) return;
      presentedStopRef.current = null;
    }

    if (!nearestStop || position.accuracy > MAX_ACCEPTABLE_ACCURACY_METERS) {
      return;
    }

    const effectiveDistance = Math.max(
      0,
      nearestStop.distance - Math.min(position.accuracy, 30),
    );

    if (effectiveDistance <= ENTER_RADIUS_METERS) {
      presentedStopRef.current = nearestStop.stop;
      setIsModalOpen(true);
    }
  }, [nearestStop, position]);

  useEffect(() => {
    if (!isModalOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsModalOpen(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isModalOpen]);

  useEffect(() => {
    if (!hasFoundClover) return;
    const timer = window.setTimeout(() => setHasFoundClover(false), 3_200);
    return () => window.clearTimeout(timer);
  }, [hasFoundClover]);

  const isNearStop = Boolean(
    nearestStop &&
    position &&
    position.accuracy <= MAX_ACCEPTABLE_ACCURACY_METERS &&
    Math.max(0, nearestStop.distance - Math.min(position.accuracy, 30)) <=
      ENTER_RADIUS_METERS,
  );

  const statusCopy = (() => {
    switch (locationStatus) {
      case "locating":
        return "위치를 찾고 있어요…";
      case "tracking":
        if (isDemoMode) return "정류장 근처에서 보이는 화면을 미리 보고 있어요";
        if (position && position.accuracy > MAX_ACCEPTABLE_ACCURACY_METERS) {
          return "GPS 오차가 커요. 하늘이 잘 보이는 곳에서 잠시 기다려 주세요.";
        }
        if (lookupStatus === "loading")
          return "반경 500m의 정류장을 찾고 있어요…";
        if (lookupStatus === "error")
          return "정류장 정보를 불러오지 못했어요. 다시 시도해 주세요.";
        if (lookupStatus === "empty")
          return "반경 500m에서 정류장을 찾지 못했어요.";
        if (lookupStatus === "ready") {
          return "주변 정류장 " + busStops.length + "곳을 확인하고 있어요";
        }
        return "현재 위치 주변의 정류장을 찾고 있어요";
      case "denied":
        return "위치 권한이 꺼져 있어요. 브라우저 설정에서 허용해 주세요.";
      case "unavailable":
        return "현재 위치를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.";
      case "unsupported":
        return "이 브라우저에서는 위치 확인을 지원하지 않아요.";
      default:
        return "위치 권한을 허용하면 전국의 가까운 정류장을 확인해요";
    }
  })();

  const locationTitle = isNearStop
    ? "정류장에 거의 다 왔어요!"
    : lookupStatus === "error"
      ? "잠시 길을 잃었어요"
      : lookupStatus === "empty"
        ? "가까운 정류장이 없어요"
        : "주변 정류장을 찾는 중이에요";

  const trackingButtonLabel = (() => {
    if (locationStatus === "locating") return "위치를 찾는 중…";
    if (isDemoMode) return "미리 보기 끝내기";
    if (locationStatus === "tracking") return "위치 확인 멈추기";
    return "내 위치 확인하기";
  })();

  const radarClassName =
    locationStatus === "locating" || lookupStatus === "loading"
      ? "radar is-locating"
      : "radar";

  return (
    <main className="app-shell">
      <div className="leaf leaf-one" aria-hidden="true" />
      <div className="leaf leaf-two" aria-hidden="true" />

      <section className="phone-frame" aria-labelledby="page-title">
        <header className="topbar">
          <a className="brand" href="#top" aria-label="행벅스 홈">
            <span className="brand-mark" aria-hidden="true">
              🍀
            </span>
            <span>행벅스</span>
          </a>
          <span className="soft-badge">전국 운행 중</span>
        </header>

        <div className="hero" id="top">
          <p className="eyebrow">오늘의 작은 행운</p>
          <h1 id="page-title">
            가까운 정류장에
            <br />
            네잎이가 기다려요
          </h1>
          <p className="hero-copy">
            어디에 있든 현재 위치 주변의 정류장을 찾고, 가까이 도착하면 숨어
            있던 네잎이가 살포시 나타나요.
          </p>
        </div>

        <section className="location-card" aria-live="polite">
          <div className={radarClassName}>
            <span aria-hidden="true">⌖</span>
          </div>

          <div className="location-content">
            <p className="location-label">
              {isDemoMode ? "데모 위치" : "현재 위치"}
            </p>
            <h2>{locationTitle}</h2>
            <p>{statusCopy}</p>
          </div>

          {nearestStop && (
            <div className="nearest-stop">
              <div>
                <span>가장 가까운 정류장</span>
                <strong>{nearestStop.stop.name}</strong>
                <small>{nearestStop.stop.description}</small>
              </div>
              <p className="distance-summary">
                <b>{formatDistance(nearestStop.distance)}</b>
                <small>GPS 오차 ±{Math.round(position?.accuracy ?? 0)}m</small>
              </p>
            </div>
          )}

          {locationStatus === "tracking" &&
            !isDemoMode &&
            position &&
            (lookupStatus === "error" || lookupStatus === "empty") && (
              <button
                className="refresh-button"
                type="button"
                onClick={() => void lookupNearbyStops(position, true)}
              >
                정류장 다시 찾기
              </button>
            )}

          <button
            className="primary-button"
            type="button"
            onClick={
              locationStatus === "tracking" ? stopTracking : startTracking
            }
            disabled={locationStatus === "locating"}
          >
            {trackingButtonLabel}
          </button>

          <button
            className="demo-button"
            type="button"
            onClick={tryDemoLocation}
          >
            정류장 근처 상황 미리 보기
          </button>

          {stopSource === "dataset" && (
            <p className="data-credit">
              정류장 데이터: 국토교통부 전국 버스정류장 위치정보
            </p>
          )}
        </section>

        <section className="how-it-works" aria-labelledby="how-title">
          <div>
            <p className="eyebrow">HOW IT WORKS</p>
            <h2 id="how-title">행운을 만나는 방법</h2>
          </div>
          <ol>
            <li>
              <span>1</span>
              <p>
                <strong>내 주변 정류장 찾기</strong>
                <small>현재 위치 반경 500m의 정류장을 자동으로 찾아요.</small>
              </p>
            </li>
            <li>
              <span>2</span>
              <p>
                <strong>정류장 가까이 가기</strong>
                <small>120m 안에 들어오면 행운이 깨어나요.</small>
              </p>
            </li>
            <li>
              <span>3</span>
              <p>
                <strong>네잎이 만나기</strong>
                <small>나타난 모달에서 작은 행운을 받아요.</small>
              </p>
            </li>
          </ol>
        </section>

        <p className="privacy-note">
          현재 좌표는 주변 정류장 조회에만 사용하며 앱에 저장하지 않아요.
        </p>
      </section>

      {isModalOpen && nearestStop && (
        <div
          className="modal-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.currentTarget === event.target) setIsModalOpen(false);
          }}
        >
          <section
            className="nearby-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            aria-describedby="modal-description"
          >
            <button
              className="close-button"
              type="button"
              onClick={() => setIsModalOpen(false)}
              aria-label="모달 닫기"
            >
              ×
            </button>
            <div className="clover-pop" aria-hidden="true">
              🍀
            </div>
            <p className="modal-kicker">행운 도착!</p>
            <h2 id="modal-title">정류장 근처에 도착했어요</h2>
            <p id="modal-description">
              <strong>{nearestStop.stop.name}</strong>에서 기다리던 네잎이를
              발견했어요.
            </p>
            <div className="distance-pill">
              정류장까지 약 {formatDistance(nearestStop.distance)}
            </div>
            <button
              className="primary-button"
              type="button"
              autoFocus
              onClick={() => {
                setHasFoundClover(true);
                setIsModalOpen(false);
              }}
            >
              네잎이 만나기
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => setIsModalOpen(false)}
            >
              조금 더 둘러볼게요
            </button>
          </section>
        </div>
      )}

      {hasFoundClover && (
        <div className="toast" role="status">
          <span aria-hidden="true">🍀</span>
          오늘의 작은 행운을 만났어요!
        </div>
      )}
    </main>
  );
}
