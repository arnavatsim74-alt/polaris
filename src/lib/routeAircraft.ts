export const splitRouteValues = (value?: string | null): string[] => {
  if (!value) return [];

  return value
    .split(/[;,|\n]/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
};


export const splitRouteAircraft = (value?: string | null): string[] =>
  splitRouteValues(value).map((entry) => entry.toUpperCase());

export const getAircraftLiveryPairs = (aircraft?: string | null, liveries?: string | null) => {
  const aircraftList = splitRouteAircraft(aircraft);
  const liveryList = splitRouteValues(liveries);

  return aircraftList.map((icao, idx) => ({
    icao,
    livery: liveryList[idx] || null,
  }));
};

export const getPrimaryAircraft = (aircraft?: string | null): string => {
  return splitRouteAircraft(aircraft)[0] || "";
};
