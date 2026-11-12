export const PARCEL_VERSION = 3;
export const GRID_ROAD_VERSION = 4;
export const ALIGNMENT_ROAD_VERSION = 5;
export const ELEVATED_ROAD_VERSION = 6;
export const ARC_ROAD_VERSION = 7;
export const CITY_VERSION = 8;
export const supportedCityVersion = version => Number.isInteger(version)&&version>=1&&version<=CITY_VERSION;
