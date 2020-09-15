import React, { PureComponent } from 'react';
import { PanelProps } from '@grafana/data';
import { PanelOptions, Buffer } from 'types';
import { Map, View } from 'ol';
import { XYZ, Vector as VectorSource } from 'ol/source';
import { Tile as TileLayer, Vector as VectorLayer } from 'ol/layer';
import Heatmap from 'ol/layer/Heatmap';
import { fromLonLat, transform } from 'ol/proj';
import { defaults, DragPan, MouseWheelZoom, Select } from 'ol/interaction';
import { platformModifierKeyOnly, click } from 'ol/events/condition';
import Feature, { FeatureLike } from 'ol/Feature';
import { Fill, Stroke, Style, Text } from 'ol/style';
import { Draw, Modify, Snap } from 'ol/interaction';
import GeometryType from 'ol/geom/GeometryType';
import { nanoid } from 'nanoid';
import { processDataES, countUnique, convertGeoJSON } from './utils/helper';
import { FeatureCollection, Point } from '@turf/helpers';
import Polygon from 'ol/geom/Polygon';
import { unByKey } from 'ol/Observable';
import { EventsKey } from 'ol/events';
import Icon from './img/save_icon.svg';
import { jsFileDownloader } from 'js-client-file-downloader';
import './style/main.css';
import 'ol/ol.css';

interface Props extends PanelProps<PanelOptions> {}
interface State {
  isDrawing: boolean;
  featureName: string;
  selectedFeature: Feature | null;
}

export class MainPanel extends PureComponent<Props, State> {
  id = 'id' + nanoid();
  map: Map;
  randomTile: TileLayer;
  drawLayer: VectorLayer;
  heatLayer: Heatmap;
  draw: Draw;
  modify: Modify;
  snap: Snap;
  select: Select;
  perDevice: { [key: string]: FeatureCollection<Point> } | null = null;

  state: State = {
    isDrawing: true,
    featureName: '',
    selectedFeature: null,
  };

  componentDidMount() {
    const { tile_url, zoom_level, center_lon, center_lat, heat_radius, heat_blur, heat_opacity } = this.props.options;

    const carto = new TileLayer({
      source: new XYZ({
        url: 'https://{1-4}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      }),
    });

    const source = new VectorSource<Polygon>();

    this.drawLayer = new VectorLayer({
      source: source,
      style: function(feature: FeatureLike) {
        const textLabel = feature.get('label');
        const textName = feature.get('name');
        return new Style({
          fill: new Fill({
            color: 'rgba(255, 255, 255, 0.2)',
          }),
          stroke: new Stroke({
            color: textName ? '#FFA500' : '#49A8DE',
            width: 2,
          }),
          text: new Text({
            stroke: new Stroke({
              color: '#fff',
              width: 2,
            }),
            font: '14px Calibri,sans-serif',
            text: textLabel,
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

    let modifiedFeatures: Feature[] = [];
    let geometryChangeListener: EventsKey | null;

    this.modify = new Modify({ source: source, pixelTolerance: 5 });
    this.map.addInteraction(this.modify);

    this.modify.on('modifystart', e => {
      modifiedFeatures.length = 0;
      e.features.forEach(feature => {
        geometryChangeListener = feature.getGeometry().on('change', () => {
          if (modifiedFeatures.indexOf(feature) == -1) {
            modifiedFeatures.push(feature);
          }
        });
      });
    });

    this.modify.on('modifyend', () => {
      if (geometryChangeListener) {
        unByKey(geometryChangeListener);
        geometryChangeListener = null;
      }

      const ft = modifiedFeatures[0].getGeometry() as Polygon;

      if (this.perDevice) {
        const converted = ft.getCoordinates()[0].map(elm => transform(elm, 'EPSG:3857', 'EPSG:4326'));
        const count = countUnique(converted as [number, number][], this.perDevice);
        modifiedFeatures[0].set('label', count);
      }
    });

    this.draw = new Draw({
      source: source,
      type: GeometryType.POLYGON,
    });
    this.map.addInteraction(this.draw);

    this.snap = new Snap({ source: source });
    this.map.addInteraction(this.snap);

    this.drawLayer.getSource().on('addfeature', ft => {
      const drawFeature = ft.feature.getGeometry() as Polygon;

      if (this.perDevice) {
        const converted = drawFeature.getCoordinates()[0].map(elm => transform(elm, 'EPSG:3857', 'EPSG:4326'));
        const count = countUnique(converted as [number, number][], this.perDevice);
        ft.feature.set('label', count);
      }
    });

    this.select = new Select({ condition: click });
    this.map.addInteraction(this.select);
    this.select.on('select', e => {
      const selectedFeature = e.target.getFeatures().item(0);
      if (selectedFeature) {
        const name = selectedFeature.get('name') || '';
        this.setState({ selectedFeature: selectedFeature, featureName: name });
      } else {
        this.setState({ selectedFeature: null, featureName: '' });
      }
    });
    this.select.setActive(false);

    if (this.props.data.series.length > 0) {
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

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.draw.getActive()) {
        this.draw.abortDrawing();
      }
    });
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

      if (this.drawLayer) {
        const features = this.drawLayer.getSource().getFeatures() as Feature<Polygon>[];
        features.forEach(feature => {
          const coordinates = feature.getGeometry().getCoordinates() as [number, number][][];
          const converted = coordinates[0].map(elm => transform(elm, 'EPSG:3857', 'EPSG:4326'));
          if (this.perDevice) {
            const count = countUnique(converted as [number, number][], this.perDevice);
            feature.set('label', count);
          }
        });
      }
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

  handleUndo = () => {
    const lastFeature = this.drawLayer
      .getSource()
      .getFeatures()
      .pop();
    lastFeature && this.drawLayer.getSource().removeFeature(lastFeature);
  };

  onSelectMode = () => {
    if (this.state.isDrawing) {
      this.setState({ isDrawing: false });
      this.draw.setActive(false);
      this.modify.setActive(false);
      this.snap.setActive(false);
      this.select.setActive(true);
    } else {
      this.setState({ isDrawing: true });
      this.draw.setActive(true);
      this.modify.setActive(true);
      this.snap.setActive(true);
      this.select.setActive(false);
    }
  };

  onInputName = (evt: React.ChangeEvent<HTMLInputElement>) => {
    if (this.state.selectedFeature) this.setState({ featureName: evt.target.value });
  };

  onSetName = (evt: React.FormEvent<HTMLFormElement>) => {
    evt.preventDefault();
    const { selectedFeature, featureName } = this.state;

    if (selectedFeature) {
      selectedFeature.set('name', featureName);
      selectedFeature.setStyle(
        new Style({
          stroke: new Stroke({
            color: '#FFA500',
            width: 2,
          }),
        })
      );
    }
  };

  onDownload = () => {
    if (this.drawLayer) {
      const obj = convertGeoJSON(this.drawLayer.getSource().getFeatures());
      jsFileDownloader.makeJSON(obj, 'geojson');
    }
  };

  render() {
    const { width, height } = this.props;
    const { featureName, isDrawing } = this.state;

    return (
      <div style={{ width, height }}>
        <div style={{ display: 'flex', padding: 5 }}>
          <div className="gf-form-switch" style={{ border: 'none' }} onClick={this.onSelectMode}>
            <input type="checkbox" checked={!isDrawing} />
            <span className="gf-form-switch__slider"></span>
          </div>

          {isDrawing && (
            <>
              <button className="btn btn-primary" style={{ marginLeft: '0.5em' }} onClick={this.clearDrawLayer}>
                Clear
              </button>
              <button className="btn btn-primary" style={{ marginLeft: '0.5em' }} onClick={this.handleUndo}>
                Undo
              </button>
            </>
          )}

          {!isDrawing && (
            <>
              <form onSubmit={this.onSetName} style={{ marginLeft: '0.5em' }}>
                <input
                  value={featureName}
                  onChange={this.onInputName}
                  style={{ padding: 5, border: '1px solid #7f7f7f', borderRadius: 4 }}
                />
              </form>
              <img src={Icon} className="icon-download" onClick={this.onDownload} />
            </>
          )}
        </div>
        <div id={this.id} style={{ width, height: height - 40 }}></div>
      </div>
    );
  }
}
