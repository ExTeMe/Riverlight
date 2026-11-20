export const PARCEL_VERSION = 3;
export const GRID_ROAD_VERSION = 4;
export const ALIGNMENT_ROAD_VERSION = 5;
export const ELEVATED_ROAD_VERSION = 6;
export const ARC_ROAD_VERSION = 7;
export const BRIDGE_PROFILE_VERSION = 8;
export const CITY_VERSION = 9;
export const RIVERFRONT_VERSION = 10;
export const supportedCityVersion = (version, allowRiverfront = false) =>
  Number.isInteger(version)&&version>=1&&version<=(allowRiverfront?RIVERFRONT_VERSION:CITY_VERSION);
