/**
 * main module of LineUp.js containing the main class and exposes all other modules
 * Created by Samuel Gratzl on 14.08.2015.
 */

import Column, {IColumnDesc} from './model/Column';
import DataProvider from './provider/ADataProvider';
import {renderers as defaultRenderers} from './renderer';
import {
  createRenderer,
  dummyRankingButtonHook,
  ILineUpRenderer,
  IPoolRendererOptions,
  IRankingHook,
  PoolRenderer
} from './ui';
import {IHeaderRendererOptions} from './ui/HeaderRenderer';
import {default as ABodyRenderer, IBodyRendererOptions} from './ui/ABodyRenderer';
import {AEventDispatcher, merge} from './utils';
import {scale as d3scale, select, selection, Selection} from 'd3';
import ICellRendererFactory from './renderer/ICellRendererFactory';

export interface IBodyOptions {
  renderer: string;
  visibleRowsOnly: boolean;
  backupScrollRows: number;
}

export interface IRenderingOptions {
  /**
   * show combined bars as stacked bars
   */
  stacked: boolean;
  /**
   * use animation for reordering
   */
  animation: boolean;
  /**
   * show histograms of the headers (just settable at the beginning)
   * @deprecated use summary instead
   */
  histograms: boolean;
  /**
   * show column summaries in the header
   */
  summary: boolean;
  /**
   * show a mean line for single numberial columns
   */
  meanLine: boolean;
}

export interface ILineUpConfig {
  /**
   * a prefix used for all generated html ids
   */
  idPrefix: string;

  /**
   * options related to the header html layout
   */
  header: Partial<IHeaderRendererOptions>;
  /**
   * old name for header
   */
  htmlLayout: Partial<IHeaderRendererOptions>;
  /**
   * visual representation options
   */
  renderingOptions: IRenderingOptions;
  /**
   * options related to the rendering of the body
   */
  body: Partial<IBodyOptions & IBodyRendererOptions>;
  /**
   * old name for body
   */
  svgLayout: Partial<IBodyOptions & IBodyRendererOptions>;
  /**
   *  enables manipulation features, remove column, reorder,...
   */
  manipulative: boolean;
  /**
   * automatically add a column pool at the end
   */
  pool: boolean|IPoolRendererOptions;

  /**
   * the renderer to use for rendering the columns
   */
  renderers: { [key: string]: ICellRendererFactory };
}

export function defaultConfig() {
  const idPrefix = `lu${Math.random().toString(36).slice(-8).substr(0, 3)}`; //generate a random string with length3;
  return {
    idPrefix,
    header: {
      idPrefix,
      headerHeight: 20,
      headerHistogramHeight: 40,
      autoRotateLabels: false,
      rotationHeight: 50, //in px
      rotationDegree: -20, //in deg
      rankingButtons: <IRankingHook>dummyRankingButtonHook,
      linkTemplates: [],
      slopeWidth: 150
    },
    htmlLayout: {},
    renderingOptions: {
      stacked: true,
      animation: true,
      summary: false,
      meanLine: false,
      histograms: false
    },
    body: {
      renderer: 'svg', //svg, canvas, html
      rowHeight: 18,
      rowPadding: 1,
      rowBarPadding: 1,
      visibleRowsOnly: true,
      backupScrollRows: 4,
      animationDuration: 1000,
      freezeCols: 0,
      slopeWidth: 150,
      actions: []
    },
    svgLayout: {},
    manipulative: true,
    pool: false,
    renderers: merge({}, defaultRenderers)
  };
}

/**
 * main LineUp class managing data and rendering
 */
export default class LineUp extends AEventDispatcher {
  /**
   * triggered when the mouse is over a specific row
   * @argument data_index:number the selected data index or <0 if no row
   */
  static readonly EVENT_HOVER_CHANGED = ABodyRenderer.EVENT_HOVER_CHANGED;

  /**
   * triggered when the user click on a row
   * @argument data_index:number the selected data index or <0 if no row
   */
  static readonly EVENT_SELECTION_CHANGED = DataProvider.EVENT_SELECTION_CHANGED;

  /**
   * triggered when the user selects one or more rows
   * @argument dataIndices:number[] the selected data indices
   */
  static readonly EVENT_MULTISELECTION_CHANGED = 'multiSelectionChanged';

  /**
   * triggered when LineUpJS.update() was called
   */
  static readonly EVENT_UPDATE_START = 'updateStart';

  /**
   * triggered when LineUpJS.update() was called and the rendering the body has finished
   */
  static readonly EVENT_UPDATE_FINISHED = 'updateFinished';

  /**
   * default config of LineUp with all available options
   */
  readonly config: ILineUpConfig = defaultConfig();

  private $container: Selection<any>;

  private pools: PoolRenderer[] = [];
  private renderer: ILineUpRenderer;

  constructor(container: Selection<any> | Element, public data: DataProvider, config: Partial<ILineUpConfig> = {}) {
    super();
    const $base = container instanceof selection ? <Selection<any>>container : select(<Element>container);
    this.$container = $base.append('div').classed('lu', true);
    this.config.svgLayout = this.config.body;
    this.config.htmlLayout = this.config.header;

    merge(this.config, config);
    //backwards compatibility
    if (this.config.renderingOptions.histograms === true) {
      this.config.renderingOptions.summary = true;
    }
    this.data.on(`${DataProvider.EVENT_SELECTION_CHANGED}.main`, this.triggerSelection.bind(this));
    this.data.on(`${DataProvider.EVENT_JUMP_TO_NEAREST}.main`, this.jumpToNearest.bind(this));

    this.renderer = createRenderer(this.config.body.renderer, this.data, this.node, this.config);
    this.forward(this.renderer, LineUp.EVENT_HOVER_CHANGED);
    if (this.config.pool && this.config.manipulative) {
      this.addPool(new PoolRenderer(data, this.node, <IPoolRendererOptions>this.config.pool));
    }
  }

  protected createEventList() {
    return super.createEventList().concat([LineUp.EVENT_HOVER_CHANGED, LineUp.EVENT_SELECTION_CHANGED, LineUp.EVENT_MULTISELECTION_CHANGED, LineUp.EVENT_UPDATE_START, LineUp.EVENT_UPDATE_FINISHED]);
  }

  /**
   * add and column pool at the given element position, with custom configuration
   * @param node the node element to attach
   * @param config
   */
  addPool(node: Element, config?: Partial<IPoolRendererOptions>): PoolRenderer;
  addPool(pool: PoolRenderer): PoolRenderer;
  addPool(poolOrNode: Element | PoolRenderer, config = typeof(this.config.pool) === 'boolean' ? {} : this.config.pool) {
    if (poolOrNode instanceof PoolRenderer) {
      this.pools.push(<PoolRenderer>poolOrNode);
    } else {
      this.pools.push(new PoolRenderer(this.data, <Element>poolOrNode, config));
    }
    return this.pools[this.pools.length - 1];
  }

  /**
   * returns the main lineup DOM element
   * @returns {Element}
   */
  get node() {
    return <Element>this.$container.node();
  }



  /**
   * destroys the DOM elements created by this lineup instance, this should be the last call to this lineup instance
   */
  destroy() {
    this.pools.forEach((p) => p.remove());
    this.$container.remove();
    this.renderer.destroy();
  }

  /**
   * sorts LineUp by he given column
   * @param column callback function finding the column to sort
   * @param ascending
   * @returns {boolean}
   */
  sortBy(column: string | ((col: Column) => boolean), ascending = false) {
    const col = this.data.find(column);
    if (col) {
      col.sortByMe(ascending);
    }
    return col !== null;
  }

  dump() {
    return this.data.dump();
  }

  changeDataStorage(data: DataProvider, dump?: any) {
    if (this.data) {
      this.data.on([`${DataProvider.EVENT_SELECTION_CHANGED}.main`, `${DataProvider.EVENT_JUMP_TO_NEAREST}.main`], null);
    }
    this.data = data;
    if (dump) {
      this.data.restore(dump);
    }
    this.data.on(`${DataProvider.EVENT_SELECTION_CHANGED}.main`, this.triggerSelection.bind(this));
    this.data.on(`${DataProvider.EVENT_JUMP_TO_NEAREST}.main`, this.jumpToNearest.bind(this));
    this.renderer.changeDataStorage(data);
    this.pools.forEach((p) => p.changeDataStorage(data));
    this.update();
  }

  private triggerSelection(dataIndices: number[]) {
    this.fire(LineUp.EVENT_SELECTION_CHANGED, dataIndices.length > 0 ? dataIndices[0] : -1);
    this.fire(LineUp.EVENT_MULTISELECTION_CHANGED, dataIndices);
  }

  private jumpToNearest(dataIndices: number[]) {
    const ranking = this.data.getRankings()[0];
    if (dataIndices.length === 0 || ranking === undefined) {
      return;
    }
    const order = ranking.getOrder();
    //relative order
    const indices = dataIndices.map((d) => order.indexOf(d)).sort((a, b) => a - b);
    this.renderer.scrollIntoView(order.length, indices[0]);
    //fake hover in 100ms - TODO right timing
    setTimeout(() => {
      this.renderer.fakeHover(order[indices[0]]);
    }, 100);
  }

  restore(dump: any) {
    this.changeDataStorage(this.data, dump);
  }

  /**
   * local variable that is used by update()
   * @type {boolean}
   */
  private isUpdateInitialized = false;

  update() {
    // HACK: when calling update for the first time the BodyRenderer
    // fires 3x the `renderFinished` event. However, we want to wait for
    // the last event before firing LineUp.EVENT_UPDATE_FINISHED.
    // For any further call of update() the body render will fire the
    // `renderFinished` event only once
    let waitForBodyRenderer = (this.isUpdateInitialized) ? 1 : 3;
    this.isUpdateInitialized = true;

    this.fire(LineUp.EVENT_UPDATE_START);
    this.renderer.update();
    this.pools.forEach((p) => p.update());

    this.renderer.on(`${ABodyRenderer.EVENT_RENDER_FINISHED}.main`, () => {
      waitForBodyRenderer -= 1;
      if (waitForBodyRenderer === 0) {
        this.fire(LineUp.EVENT_UPDATE_FINISHED);
      }
    });
  }

  changeRenderingOption(option: keyof IRenderingOptions, value: boolean) {
    this.config.renderingOptions[option] = value;
    if (option === 'animation' || option === 'stacked') {
      this.renderer.setBodyOption(option, value);
    }
  }
}

/**
 * assigns colors to columns if they are numbers and not yet defined
 * @param columns
 * @returns {IColumnDesc[]}
 */
export function deriveColors(columns: IColumnDesc[]) {
  const colors = d3scale.category10().range().slice();
  columns.forEach((col: any) => {
    switch (col.type) {
      case 'number':
        col.color = colors.shift();
        break;
    }
  });
  return columns;
}
