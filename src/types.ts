import { DataFrame, Field, Vector } from '@grafana/data';

export interface PanelOptions {
  center_lat: number;
  center_lon: number;
  tile_url: string;
  zoom_level: number;
  heat_blur: string;
  heat_radius: string;
  heat_opacity: string;
}

export const defaults: PanelOptions = {
  center_lat: 48.262725,
  center_lon: 11.66725,
  tile_url: '',
  zoom_level: 18,
  heat_blur: '15',
  heat_radius: '5',
  heat_opacity: '0.9',
};

export interface Buffer extends Vector {
  buffer: any;
}

export interface FieldBuffer extends Field<any, Vector> {
  values: Buffer;
}

export interface Frame extends DataFrame {
  fields: FieldBuffer[];
}
