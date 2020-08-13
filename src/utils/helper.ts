import { points, polygon, FeatureCollection, Point } from '@turf/helpers';
import pointsWithinPolygon from '@turf/points-within-polygon';

interface Item {
  latitude: number;
  longitude: number;
  hash_id: string;
  [key: string]: any;
}

export const processDataES = (data: Item[]) => {
  data.reverse();
  const perDeviceCoord: { [key: string]: [number, number][] } = {};
  data.map(elm => {
    (perDeviceCoord[elm.hash_id] = perDeviceCoord[elm.hash_id] || []).push([elm.longitude, elm.latitude]);
  });
  const perDevice: { [key: string]: FeatureCollection<Point> } = {};
  Object.keys(perDeviceCoord).map(hash => {
    perDevice[hash] = points(perDeviceCoord[hash]);
  });

  return perDevice;
};

export const countUnique = (coord: [number, number][], perDevice: { [key: string]: FeatureCollection<Point> }) => {
  let count = 0;
  const polygonGeoJSON = polygon([coord]);
  Object.keys(perDevice).map(hash => {
    const ptsWithin = pointsWithinPolygon(perDevice[hash], polygonGeoJSON);
    if (ptsWithin.features.length > 0) count++;
  });
  return count;
};
