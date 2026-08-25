import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";

const inputPath = process.argv[2];
const outputPath = resolve("data/bus-stops.min.json.br");

if (!inputPath) {
  console.error(
    "Usage: npm run data:build -- <path-to-bus-stop-csv>",
  );
  process.exit(1);
}

function* parseCsv(text) {
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      yield row;
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    yield row;
  }
}

const sourceBuffer = await readFile(resolve(inputPath));
const sourceText = new TextDecoder("euc-kr")
  .decode(sourceBuffer)
  .replace(/^\uFEFF/, "");
const rows = parseCsv(sourceText);
const header = rows.next().value;

if (!header) throw new Error("The CSV file is empty.");

const columnIndex = new Map(header.map((name, index) => [name.trim(), index]));
const requiredColumns = ["정류장번호", "정류장명", "위도", "경도"];

for (const column of requiredColumns) {
  if (!columnIndex.has(column)) {
    throw new Error(`Required column is missing: ${column}`);
  }
}

const stops = [];
const seenStops = new Set();
let validCount = 0;
let invalidCount = 0;
let duplicateCount = 0;

for (const row of rows) {
  const latitude = Number(row[columnIndex.get("위도")]);
  const longitude = Number(row[columnIndex.get("경도")]);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    invalidCount += 1;
    continue;
  }

  const name = row[columnIndex.get("정류장명")]?.trim() || "이름 없는 정류장";
  const duplicateKey = `${name}\u0000${latitude}\u0000${longitude}`;

  if (seenStops.has(duplicateKey)) {
    duplicateCount += 1;
    continue;
  }

  seenStops.add(duplicateKey);
  stops.push([name, latitude, longitude]);
  validCount += 1;
}

stops.sort((left, right) => left[1] - right[1] || left[2] - right[2]);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  brotliCompressSync(JSON.stringify(stops), {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
    },
  }),
);

console.log(`Created ${outputPath}`);
console.log(`Indexed ${validCount.toLocaleString()} stops`);
console.log(`Skipped ${invalidCount.toLocaleString()} invalid rows`);
console.log(`Removed ${duplicateCount.toLocaleString()} duplicate rows`);
