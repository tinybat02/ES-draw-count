// @ts-ignore
import { PanelPlugin } from '@grafana/ui';
import { PanelOptions, defaults } from './types';
import { MainPanel } from './MainPanel';
import { MainEditor } from './MainEditor';

export const plugin = new PanelPlugin<PanelOptions>(MainPanel).setDefaults(defaults).setEditor(MainEditor);
