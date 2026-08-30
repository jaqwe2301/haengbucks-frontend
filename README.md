# 행운행

현재 위치 주변의 버스정류장을 찾고, 정류장에 가까워지면 작은 행운을 보여주는 웹 앱입니다.

## 요구 사항

- Node.js `>=22.13.0`
- npm

## 실행 방법

```bash
npm ci
npm run dev
```

개발 서버가 출력한 로컬 주소를 브라우저에서 여세요.

## 정류장 데이터

국토교통부 전국 버스정류장 위치정보 CSV를 공간 인덱스로 변환해 사용합니다. 외부 정류장 API 키는 필요하지 않습니다.

원본 CSV가 갱신되면 다음 명령으로 `data/bus-stops.min.json.br`를 다시 생성하세요. 이 파일에는 정류장명, 위도, 경도만 저장됩니다.

```bash
npm run data:build -- "원본 CSV 파일 경로"
```

## 주요 명령

- `npm run dev`: 개발 서버 실행
- `npm run build`: 프로덕션 빌드
- `npm test`: 빌드 및 렌더링 테스트
- `npm run lint`: 정적 검사
- `npm run db:generate`: Drizzle 마이그레이션 생성
- `npm run data:build -- "CSV 경로"`: 정류장 공간 인덱스 갱신

## 기술 구성

- Next.js / React
- Drizzle ORM
