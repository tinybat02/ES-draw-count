import { points, polygon, FeatureCollection, Point } from '@turf/helpers';
import pointsWithinPolygon from '@turf/points-within-polygon';
import Feature from 'ol/Feature';
import OlPoint from 'ol/geom/Point';
import VectorSource from 'ol/source/Vector';

interface Item {
  latitude: number;
  longitude: number;
  hash_id: string;
  [key: string]: any;
}

export const processDataES = (data: Item[]) => {
  data.reverse();
  const perDeviceCoord: { [key: string]: [number, number][] } = {};
  const heatPoints: Feature[] = [];

  data.map(elm => {
    (perDeviceCoord[elm.hash_id] = perDeviceCoord[elm.hash_id] || []).push([elm.longitude, elm.latitude]);
    heatPoints.push(new Feature(new OlPoint([elm.longitude, elm.latitude]).transform('EPSG:4326', 'EPSG:3857')));
  });

  const perDevice: { [key: string]: FeatureCollection<Point> } = {};
  Object.keys(perDeviceCoord).map(hash => {
    perDevice[hash] = points(perDeviceCoord[hash]);
  });

  return {
    perDevice,
    heatSource: new VectorSource({
      features: heatPoints,
    }),
  };
};

export const countUnique = (coord: [number, number][], perDevice: { [key: string]: FeatureCollection<Point> }) => {
  let count = 0;
  const polygonGeoJSON = polygon([coord]);
  Object.keys(perDevice).map(hash => {
    const ptsWithin = pointsWithinPolygon(perDevice[hash], polygonGeoJSON);
    if (ptsWithin.features.length > 1) count++;
  });
  return count;
};
