import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { brotliDecompressSync } from "node:zlib";

const SEARCH_RADIUS_METERS = 500;
const MAX_RESULTS = 50;
const EARTH_RADIUS_METERS = 6_371_000;

export const runtime = "nodejs";

type BusStop = {
  id: string;
  name: string;
  description: string;
  latitude: number;
  longitude: number;
};

type IndexedStop = [
  name: string,
  latitude: number,
  longitude: number,
];

type BusStopIndex = IndexedStop[];

let indexPromise: Promise<BusStopIndex> | null = null;

const jsonResponse = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });

const loadBusStopIndex = () => {
  indexPromise ??= readFile(resolve("data/bus-stops.min.json.br")).then(
    (compressedData) =>
      JSON.parse(
        brotliDecompressSync(compressedData).toString("utf8"),
      ) as BusStopIndex,
  );

  return indexPromise;
};

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

const getDistanceInMeters = (
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number,
) => {
  const latitudeDelta = toRadians(toLatitude - fromLatitude);
  const longitudeDelta = toRadians(toLongitude - fromLongitude);
  const fromLatitudeRadians = toRadians(fromLatitude);
  const toLatitudeRadians = toRadians(toLatitude);

  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitudeRadians) *
      Math.cos(toLatitudeRadians) *
      Math.sin(longitudeDelta / 2) ** 2;

  return (
    EARTH_RADIUS_METERS *
    2 *
    Math.atan2(
      Math.sqrt(Math.min(1, Math.max(0, haversine))),
      Math.sqrt(1 - Math.min(1, Math.max(0, haversine))),
    )
  );
};

const findNearbyStops = async (latitude: number, longitude: number) => {
  const index = await loadBusStopIndex();
  const latitudeDelta = SEARCH_RADIUS_METERS / 111_320;
  const minimumLatitude = latitude - latitudeDelta;
  const maximumLatitude = latitude + latitudeDelta;
  const matches: Array<{ stop: BusStop; distance: number }> = [];

  let lowerBound = 0;
  let upperBound = index.length;

  while (lowerBound < upperBound) {
    const middle = Math.floor((lowerBound + upperBound) / 2);
    if (index[middle][1] < minimumLatitude) lowerBound = middle + 1;
    else upperBound = middle;
  }

  for (let indexPosition = lowerBound; indexPosition < index.length; indexPosition += 1) {
    const [name, stopLatitude, stopLongitude] = index[indexPosition];
    if (stopLatitude > maximumLatitude) break;

        const distance = getDistanceInMeters(
          latitude,
          longitude,
          stopLatitude,
          stopLongitude,
        );

        if (distance > SEARCH_RADIUS_METERS) continue;

        matches.push({
          stop: {
            id: `dataset:${indexPosition}`,
            name,
            description: "전국 버스정류장 위치정보",
            latitude: stopLatitude,
            longitude: stopLongitude,
          },
          distance,
        });
  }

  return matches
    .sort((left, right) => left.distance - right.distance)
    .slice(0, MAX_RESULTS)
    .map(({ stop }) => stop);
};

export async function POST(request: Request) {
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin && requestOrigin !== new URL(request.url).origin) {
    return jsonResponse({ message: "허용되지 않은 요청이에요." }, 403);
  }

  let requestBody: { latitude?: unknown; longitude?: unknown };

  try {
    requestBody = (await request.json()) as {
      latitude?: unknown;
      longitude?: unknown;
    };
  } catch {
    return jsonResponse({ message: "위치 정보 형식이 올바르지 않아요." }, 400);
  }

  const latitude = Number(requestBody.latitude);
  const longitude = Number(requestBody.longitude);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return jsonResponse({ message: "유효한 위치가 필요해요." }, 400);
  }

  try {
    const stops = await findNearbyStops(latitude, longitude);

    return jsonResponse({
      stops,
      source: "dataset",
      radiusMeters: SEARCH_RADIUS_METERS,
    });
  } catch (error) {
    console.error(
      "Local bus stop dataset lookup failed:",
      error instanceof Error ? error.message : error,
    );

    return jsonResponse(
      { message: "정류장 데이터 파일을 불러오지 못했어요." },
      500,
    );
  }
}
