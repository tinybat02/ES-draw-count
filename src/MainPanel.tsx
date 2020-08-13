import React, { PureComponent } from 'react';
import { PanelProps } from '@grafana/data';
import { PanelOptions, Buffer } from 'types';
import { Map, View } from 'ol';
import { XYZ, Vector as VectorSource } from 'ol/source';
import { Tile as TileLayer, Vector as VectorLayer } from 'ol/layer';
import Heatmap from 'ol/layer/Heatmap';
import { fromLonLat, transform } from 'ol/proj';
import { defaults, DragPan, MouseWheelZoom } from 'ol/interaction';
import { platformModifierKeyOnly } from 'ol/events/condition';
import { FeatureLike } from 'ol/Feature';
import { Fill, Stroke, Style, Circle as CircleStyle, Text } from 'ol/style';
import { Draw, Snap } from 'ol/interaction';
import GeometryType from 'ol/geom/GeometryType';
import { nanoid } from 'nanoid';
import { processDataES, countUnique } from './utils/helper';
import { FeatureCollection, Point } from '@turf/helpers';
import 'ol/ol.css';

interface Props extends PanelProps<PanelOptions> {}
interface State {}

export class MainPanel extends PureComponent<Props, State> {
  id = 'id' + nanoid();
  map: Map;
  randomTile: TileLayer;
  drawLayer: VectorLayer;
  heatLayer: Heatmap;
  draw: Draw;
  snap: Snap;
  perDevice: { [key: string]: FeatureCollection<Point> } | null = null;

  componentDidMount() {
    const { tile_url, zoom_level, center_lon, center_lat, heat_radius, heat_blur, heat_opacity } = this.props.options;

    const carto = new TileLayer({
      source: new XYZ({
        url: 'https://{1-4}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      }),
    });

    const source = new VectorSource();

    this.drawLayer = new VectorLayer({
      source: source,
      style: function(feature: FeatureLike) {
        const textLabel = feature.get('id') || feature.get('name');
        const offsetY = feature.getGeometry().getType() === 'Point' ? -12 : 0;
        return new Style({
          fill: new Fill({
            color: 'rgba(255, 255, 255, 0.2)',
          }),
          stroke: new Stroke({
            color: '#49A8DE',
            width: 2,
          }),
          image: new CircleStyle({
            radius: 7,
            fill: new Fill({
              color: '#49A8DE',
            }),
          }),
          text: new Text({
            stroke: new Stroke({
              color: '#fff',
              width: 2,
            }),
            font: '14px Calibri,sans-serif',
            text: textLabel,
            offsetY: offsetY,
            overflow: true,
          }),
        });
      },
      zIndex: 3,
    });

    this.map = new Map({
      interactions: defaults({ dragPan: false, mouseWheelZoom: false, onFocusOnly: true }).extend([
        new DragPan({
          condition: function(event) {
            return platformModifierKeyOnly(event) || this.getPointerCount() === 2;
          },
        }),
        new MouseWheelZoom({
          condition: platformModifierKeyOnly,
        }),
      ]),
      layers: [carto, this.drawLayer],
      view: new View({
        center: fromLonLat([center_lon, center_lat]),
        zoom: zoom_level,
      }),
      target: this.id,
    });

    if (tile_url !== '') {
      this.randomTile = new TileLayer({
        source: new XYZ({
          url: tile_url,
        }),
        zIndex: 1,
      });
      this.map.addLayer(this.randomTile);
    }

    this.draw = new Draw({
      source: source,
      type: GeometryType.POLYGON,
    });
    this.map.addInteraction(this.draw);
    this.snap = new Snap({ source: source });
    this.map.addInteraction(this.snap);

    this.drawLayer.getSource().on('addfeature', ft => {
      //@ts-ignore
      const coordinates: [number, number][][] = ft.feature.getGeometry().getCoordinates();

      if (this.perDevice) {
        const converted = coordinates[0].map(elm => {
          return transform(elm, 'EPSG:3857', 'EPSG:4326');
        });
        const count = countUnique(converted as [number, number][], this.perDevice);
        ft.feature.set('name', count);
      }
    });

    if (this.props.data.series.length > 0) {
      const { buffer } = this.props.data.series[0].fields[0].values as Buffer;
      // this.perDevice = processDataES(buffer);
      const { perDevice, heatSource } = processDataES(buffer);
      this.perDevice = perDevice;
      this.heatLayer = new Heatmap({
        source: heatSource,
        blur: parseInt(heat_blur, 10),
        radius: parseInt(heat_radius, 10),
        opacity: parseFloat(heat_opacity),
        zIndex: 2,
      });
      this.map.addLayer(this.heatLayer);
    }
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.data.series[0] !== this.props.data.series[0]) {
      this.perDevice = null;
      this.map.removeLayer(this.heatLayer);
      if (this.props.data.series.length == 0) {
        return;
      }
      const { heat_blur, heat_radius, heat_opacity } = this.props.options;
      const { buffer } = this.props.data.series[0].fields[0].values as Buffer;

      const { perDevice, heatSource } = processDataES(buffer);
      this.perDevice = perDevice;

      this.heatLayer = new Heatmap({
        source: heatSource,
        blur: parseInt(heat_blur, 10),
        radius: parseInt(heat_radius, 10),
        opacity: parseFloat(heat_opacity),
        zIndex: 2,
      });
      this.map.addLayer(this.heatLayer);
    }

    if (prevProps.options.tile_url !== this.props.options.tile_url) {
      if (this.randomTile) {
        this.map.removeLayer(this.randomTile);
      }
      if (this.props.options.tile_url !== '') {
        this.randomTile = new TileLayer({
          source: new XYZ({
            url: this.props.options.tile_url,
          }),
          zIndex: 1,
        });
        this.map.addLayer(this.randomTile);
      }
    }

    if (prevProps.options.zoom_level !== this.props.options.zoom_level) {
      this.map.getView().setZoom(this.props.options.zoom_level);
    }

    if (
      prevProps.options.center_lat !== this.props.options.center_lat ||
      prevProps.options.center_lon !== this.props.options.center_lon
    ) {
      this.map.getView().animate({
        center: fromLonLat([this.props.options.center_lon, this.props.options.center_lat]),
        duration: 2000,
      });
    }
  }

  clearDrawLayer = () => {
    const features = this.drawLayer.getSource().getFeatures();
    features.forEach(feature => {
      this.drawLayer.getSource().removeFeature(feature);
    });
  };

  render() {
    const { width, height } = this.props;

    return (
      <div style={{ width, height }}>
        <div style={{ padding: 5 }}>
          <button className="btn btn-primary" onClick={this.clearDrawLayer}>
            Clear Draw
          </button>
        </div>
        <div id={this.id} style={{ width, height: height - 40 }}></div>
      </div>
    );
  }
}
