/**
 * Created by Samuel Gratzl on 14.08.2015.
 */

import {Selection, select, mouse as d3mouse, event as d3event} from 'd3-selection';
import {scaleLinear, scaleBand} from 'd3-scale';
import {range as d3range} from 'd3-array';
import {drag as d3drag, D3DragEvent} from 'd3-drag';
import {merge, dropAble, delayedCall, forEach} from '../utils';
import Column, {IStatistics, ICategoricalStatistics, IFlatColumn} from '../model/Column';
import StringColumn from '../model/StringColumn';
import Ranking from '../model/Ranking';
import {IMultiLevelColumn, isMultiLevelColumn} from '../model/CompositeColumn';
import NumberColumn, {isNumberColumn, INumberColumn} from '../model/NumberColumn';
import CategoricalColumn, {isCategoricalColumn} from '../model/CategoricalColumn';
import RankColumn from '../model/RankColumn';
import StackColumn, {createDesc as createStackDesc} from '../model/StackColumn';
import LinkColumn from '../model/LinkColumn';
import ScriptColumn from '../model/ScriptColumn';
import DataProvider from '../provider/ADataProvider';
import {
  ColumnSelection,
  filterDialogs,
  openEditWeightsDialog,
  openEditLinkDialog,
  openEditScriptDialog,
  openRenameDialog,
  openSearchDialog
} from '../ui_dialogs';

/**
 * utility function to generate the tooltip text with description
 * @param col the column
 */
export function toFullTooltip(col: { label: string, description?: string}) {
  let base = col.label;
  if (col.description != null && col.description !== '') {
    base += '\n' + col.description;
  }
  return base;
}

export interface IRankingHook {
  ($node: Selection<HTMLElement, Ranking, any, void>): void;
}

export function dummyRankingButtonHook() {
  return null;
}

export interface IHeaderRendererOptions {
  idPrefix?: string;
  slopeWidth?: number;
  columnPadding?: number;
  headerHistogramHeight?: number;
  headerHeight?: number;
  manipulative?: boolean;
  histograms?: boolean;

  filterDialogs?: { [type: string]: (col: Column, $header: ColumnSelection, data: DataProvider, idPrefix: string)=>void };
  linkTemplates?: string[];
  searchAble?(col: Column): boolean;
  sortOnLabel?: boolean;

  autoRotateLabels?: boolean;
  rotationHeight?: number;
  rotationDegree?: number;

  freezeCols?: number;

  rankingButtons?: IRankingHook;
}

function countMultiLevel(c: Column): number {
  if (isMultiLevelColumn(c) && !(<IMultiLevelColumn>c).getCollapsed() && !c.getCompressed()) {
    return 1 + Math.max.apply(Math, (<IMultiLevelColumn>c).children.map(countMultiLevel));
  }
  return 1;
}function stopDragEvent() {
  const event = (<D3DragEvent<HTMLElement, Column, HTMLElement>>d3event).sourceEvent;
  event.stopPropagation();
  event.preventDefault();
}



export default class HeaderRenderer {
  private options: IHeaderRendererOptions = {
    idPrefix: '',
    slopeWidth: 150,
    columnPadding: 5,
    headerHistogramHeight: 40,
    headerHeight: 20,
    manipulative: true,
    histograms: false,

    filterDialogs: filterDialogs(),
    linkTemplates: [],
    searchAble: (col: Column) => col instanceof StringColumn,
    sortOnLabel: true,

    autoRotateLabels: false,
    rotationHeight: 50, //in px
    rotationDegree: -20, //in deg

    freezeCols: 0,

    rankingButtons: <IRankingHook>dummyRankingButtonHook
  };

  $node: Selection<HTMLElement, any, Element, null>;

  private histCache = new Map<string,Promise<IStatistics|ICategoricalStatistics>>();

  private dragHandler = d3drag<HTMLElement, Column>()
  //.origin((d) => d)
    .on('start', function () {
      select(this).classed('dragging', true);
      stopDragEvent();
    })
    .on('drag', function (d) {
      //the new width
      const newValue = Math.max(d3mouse(<HTMLElement>this.parentNode)[0], 2);
      d.setWidth(newValue);
      stopDragEvent();
    })
    .on('end', function (d) {
      select(this).classed('dragging', false);
      stopDragEvent();
    });

  private dropHandler = dropAble(['application/caleydo-lineup-column-ref', 'application/caleydo-lineup-column'], (data, d: Column, copy) => {
    let col: Column = null;
    if ('application/caleydo-lineup-column-ref' in data) {
      const id = data['application/caleydo-lineup-column-ref'];
      col = this.data.find(id);
      if (copy) {
        col = this.data.clone(col);
      } else {
        col.removeMe();
      }
    } else {
      const desc = JSON.parse(data['application/caleydo-lineup-column']);
      col = this.data.create(this.data.fromDescRef(desc));
    }
    if (d instanceof Column) {
      return d.insertAfterMe(col) != null;
    } else {
      const r = this.data.getLastRanking();
      return r.push(col) !== null;
    }
  });


  constructor(private data: DataProvider, parent: Element, options: IHeaderRendererOptions) {
    merge(this.options, options);

    this.$node = select(parent).append<HTMLElement>('div').classed('lu-header', true);
    this.$node.append('div').classed('drop', true).call(this.dropHandler);

    this.changeDataStorage(data);
  }

  changeDataStorage(data: DataProvider) {
    if (this.data) {
      this.data.on([DataProvider.EVENT_DIRTY_HEADER + '.headerRenderer', DataProvider.EVENT_ORDER_CHANGED + '.headerRenderer', DataProvider.EVENT_SELECTION_CHANGED + '.headerRenderer'], null);
    }
    this.data = data;
    data.on(DataProvider.EVENT_DIRTY_HEADER + '.headerRenderer', delayedCall(this.update.bind(this), 1));
    if (this.options.histograms) {
      data.on(DataProvider.EVENT_ORDER_CHANGED + '.headerRenderer', () => {
        this.updateHist();
        this.update();
      });
      data.on(DataProvider.EVENT_SELECTION_CHANGED + '.headerRenderer', delayedCall(this.drawSelection.bind(this), 1));
    }
  }

  get sharedHistCache() {
    return this.histCache;
  }

  /**
   * defines the current header height in pixel
   * @returns {number}
   */
  currentHeight() {
    return parseInt(this.$node.style('height'), 10);
  }

  private updateHist() {
    const rankings = this.data.getRankings();
    rankings.forEach((ranking) => {
      const order = ranking.getOrder();
      const cols = ranking.flatColumns;
      const histo = order == null ? null : this.data.stats(order);
      cols.filter((d) => d instanceof NumberColumn && !d.isHidden()).forEach((col: any) => {
        this.histCache.set(col.id, histo === null ? null : histo.stats(col));
      });
      cols.filter((d) => isCategoricalColumn(d) && !d.isHidden()).forEach((col: any) => {
        this.histCache.set(col.id, histo === null ? null : histo.hist(col));
      });
    });
  }

  /**
   * update the selection in the histograms
   */
  drawSelection() {
    if (!this.options.histograms) {
      return;
    }
    //highlight the bins in the histograms
    const node = <HTMLElement>this.$node.node();

    forEach(node, 'div.bar', (d) => d.classList.remove('selected'));
    const indices = this.data.getSelection();
    if (indices.length <= 0) {
      return;
    }
    this.data.view(indices).then((data) => {
      //get the data

      const rankings = this.data.getRankings();

      rankings.forEach((ranking) => {
        const cols = ranking.flatColumns;
        //find all number histograms
        cols.filter((d) => d instanceof NumberColumn && !d.isHidden()).forEach((col: NumberColumn) => {
          const bars = [].slice.call(node.querySelectorAll(`div.header[data-id="${col.id}"] div.bar`));
          data.forEach((d, i) => {
            const v = col.getValue(d, indices[i]);
            //choose the right bin
            for (let i = 1; i < bars.length; ++i) {
              let bar = bars[i];
              if (bar.dataset.x > v) { //previous bin
                bars[i - 1].classList.add('selected');
                break;
              } else if (i === bars.length - 1) { //last bin
                bar.classList.add('selected');
                break;
              }
            }
          });
        });
        cols.filter((d) => isCategoricalColumn(d) && !d.isHidden()).forEach((col: CategoricalColumn) => {
          const header = node.querySelector(`div.header[data-id="${col.id}"]`);
          data.forEach((d, i) => {
            const cats = col.getCategories(d, indices[i]);
            (cats || []).forEach((cat) => {
              header.querySelector(`div.bar[data-cat="${cat}"]`).classList.add('selected');
            });
          });
        });
      });
    });
  }

  private renderRankingButtons(rankings: Ranking[], rankingsOffsets: number[]) {
    const $rankingbuttons_update = this.$node.selectAll('div.rankingbuttons').data(rankings);
    $rankingbuttons_update.enter().append('div')
      .classed('rankingbuttons', true)
      .call(this.options.rankingButtons)
      .merge($rankingbuttons_update)
      .style('left', (d, i) => rankingsOffsets[i] + 'px');
    $rankingbuttons_update.exit().remove();
  }

  update() {
    const that = this;
    const rankings = this.data.getRankings();

    let shifts: IFlatColumn[] = [], totalWidth = 0, rankingOffsets = [];
    rankings.forEach((ranking) => {
      totalWidth += ranking.flatten(shifts, totalWidth, 1, this.options.columnPadding) + this.options.slopeWidth;
      rankingOffsets.push(totalWidth - this.options.slopeWidth);
    });
    //real width
    totalWidth -= this.options.slopeWidth;

    // fix for #179
    this.$node.select('div.drop').style('width', totalWidth + 'px');

    const columns = shifts.map((d) => d.col);

    //update all if needed
    if (this.options.histograms && this.histCache.size === 0 && rankings.length > 0) {
      this.updateHist();
    }

    this.renderColumns(columns, shifts);

    if (this.options.rankingButtons !== dummyRankingButtonHook) {
      this.renderRankingButtons(rankings, rankingOffsets);
    }

    const levels = Math.max(...columns.map(countMultiLevel));
    let height = (this.options.histograms ? this.options.headerHistogramHeight : this.options.headerHeight) + (levels - 1) * this.options.headerHeight;

    if (this.options.autoRotateLabels) {
      //check if we have overflows
      let rotatedAny = false;
      this.$node.selectAll<HTMLElement, Column>('div.header')
        .style('height', height + 'px').select<HTMLElement>('div.lu-label').each(function (d: Column) {
        const w = this.querySelector('span.lu-label').offsetWidth;
        const actWidth = d.getWidth();
        if (w > (actWidth + 30)) { //rotate
          select(this).style('transform', `rotate(${that.options.rotationDegree}deg)`);
          rotatedAny = true;
        } else {
          select(this).style('transform', null);
        }
      });
      this.$node.selectAll('div.header').style('margin-top', rotatedAny ? this.options.rotationHeight + 'px' : null);
      height += rotatedAny ? this.options.rotationHeight : 0;
    }
    this.$node.style('height', height + 'px');
  }

  private createToolbar($node: ColumnSelection) {
    const filterDialogs = this.options.filterDialogs,
      provider = this.data,
      that = this;
    const $regular = $node.filter(d => !(d instanceof RankColumn));

    //rename
    $regular.append<HTMLElement>('i').attr('class', 'fa fa-pencil-square-o').attr('title', 'Rename').on('click', function (d) {
      openRenameDialog(d, select<HTMLElement, Column>(this.parentElement.parentElement));
      (<MouseEvent>d3event).stopPropagation();
    });
    //clone
    $regular.append<HTMLElement>('i').attr('class', 'fa fa-code-fork').attr('title', 'Generate Snapshot').on('click', function (d) {
      provider.takeSnapshot(d);
      (<MouseEvent>d3event).stopPropagation();
    });
    //edit link
    $node.filter((d) => d instanceof LinkColumn).append<HTMLElement>('i').attr('class', 'fa fa-external-link').attr('title', 'Edit Link Pattern').on('click', function (d) {
      openEditLinkDialog(<LinkColumn>d, select<HTMLElement, Column>(this.parentElement.parentElement), [].concat((<any>d.desc).templates || [], that.options.linkTemplates), that.options.idPrefix);
      (<MouseEvent>d3event).stopPropagation();
    });
    //edit script
    $node.filter((d) => d instanceof ScriptColumn).append<HTMLElement>('i').attr('class', 'fa fa-gears').attr('title', 'Edit Combine Script').on('click', function (d) {
      openEditScriptDialog(<ScriptColumn>d, select<HTMLElement, Column>(this.parentElement.parentElement));
      (<MouseEvent>d3event).stopPropagation();
    });
    //filter
    $node.filter((d) => filterDialogs.hasOwnProperty(d.desc.type)).append<HTMLElement>('i').attr('class', 'fa fa-filter').attr('title', 'Filter').on('click', function (d) {
      filterDialogs[d.desc.type](d, select<HTMLElement, Column>(this.parentElement.parentElement), provider, that.options.idPrefix);
      (<MouseEvent>d3event).stopPropagation();
    });
    //search
    $node.filter((d) => this.options.searchAble(d)).append<HTMLElement>('i').attr('class', 'fa fa-search').attr('title', 'Search').on('click', function (d) {
      openSearchDialog(d, select<HTMLElement, Column>(this.parentElement.parentElement), provider);
      (<MouseEvent>d3event).stopPropagation();
    });
    //edit weights
    $node.filter((d) => d instanceof StackColumn).append<HTMLElement>('i').attr('class', 'fa fa-tasks').attr('title', 'Edit Weights').on('click', function (d) {
      openEditWeightsDialog(<StackColumn>d,  select<HTMLElement, Column>(this.parentElement.parentElement));
      (<MouseEvent>d3event).stopPropagation();
    });
    //collapse
    $regular.append('i')
      .attr('class', 'fa')
      .classed('fa-toggle-left', (d: Column) => !d.getCompressed())
      .classed('fa-toggle-right', (d: Column) => d.getCompressed())
      .attr('title', '(Un)Collapse')
      .on('click', function (d: Column) {
        d.setCompressed(!d.getCompressed());
        select(this)
          .classed('fa-toggle-left', !d.getCompressed())
          .classed('fa-toggle-right', d.getCompressed());
        (<MouseEvent>d3event).stopPropagation();
      });
    //compress
    $node.filter((d) => isMultiLevelColumn(d)).append('i')
      .attr('class', 'fa')
      .classed('fa-compress', (d: IMultiLevelColumn) => !d.getCollapsed())
      .classed('fa-expand', (d: IMultiLevelColumn) => d.getCollapsed())
      .attr('title', 'Compress/Expand')
      .on('click', function (d: IMultiLevelColumn) {
        d.setCollapsed(!d.getCollapsed());
        select(this)
          .classed('fa-compress', !d.getCollapsed())
          .classed('fa-expand', d.getCollapsed());
        (<MouseEvent>d3event).stopPropagation();
      });
    //remove
    $node.append('i').attr('class', 'fa fa-times').attr('title', 'Hide').on('click', (d) => {
      if (d instanceof RankColumn) {
        provider.removeRanking(d.findMyRanker());
        if (provider.getRankings().length === 0) { //create at least one
          provider.pushRanking();
        }
      } else {
        d.removeMe();
      }
      (<MouseEvent>d3event).stopPropagation();
    });
  }

  updateFreeze(left: number) {
    const numColumns = this.options.freezeCols;
    this.$node.selectAll('div.header')
      .style('z-index', (d, i) => i < numColumns ? 1 : null)
      .style('transform', (d, i) => i < numColumns ? `translate(${left}px,0)` : null);
  }

  private renderColumns(columns: Column[], shifts: IFlatColumn[], $base: Selection<HTMLElement, any, Element, void> = this.$node, clazz: string = 'header') {
    const that = this;
    const $headers_update = $base.selectAll<HTMLElement, Column>('div.' + clazz).data(columns, (d) => d.id);
    const $headers_enter = $headers_update.enter().append<HTMLElement>('div').attr('class', clazz)
      .on('click', (d) => {
        const mevent = <MouseEvent>d3event;
        if (this.options.manipulative && !mevent.defaultPrevented && mevent.currentTarget === mevent.target) {
          d.toggleMySorting();
        }
      });
    const $header_enter_div = $headers_enter.append('div').classed('lu-label', true)
      .on('click', (d) => {
        const mevent = <MouseEvent>d3event;
        if (this.options.manipulative && !mevent.defaultPrevented) {
          d.toggleMySorting();
        }
      })
      .on('dragstart', (d) => {
        var e = <DragEvent>(<any>d3event);
        e.dataTransfer.effectAllowed = 'copyMove'; //none, copy, copyLink, copyMove, link, linkMove, move, all
        e.dataTransfer.setData('text/plain', d.label);
        e.dataTransfer.setData('application/caleydo-lineup-column-ref', d.id);
        const ref = JSON.stringify(this.data.toDescRef(d.desc));
        e.dataTransfer.setData('application/caleydo-lineup-column', ref);
        if (isNumberColumn(d)) {
          e.dataTransfer.setData('application/caleydo-lineup-column-number', ref);
          e.dataTransfer.setData('application/caleydo-lineup-column-number-ref', d.id);
        }
      });
    $header_enter_div.append('i').attr('class', 'fa fa sort_indicator');
    $header_enter_div.append('span').classed('lu-label', true).attr('draggable', this.options.manipulative);

    if (this.options.manipulative) {
      $headers_enter.append('div').classed('handle', true)
        .call(this.dragHandler)
        .style('width', this.options.columnPadding + 'px')
        .call(this.dropHandler);
      $headers_enter.append('div').classed('toolbar', true).call(this.createToolbar.bind(this));
    }

    if (this.options.histograms) {
      $headers_enter.append('div').classed('histogram', true);
    }
    const $headers = $headers_update.merge($headers_enter);

    $headers.style('width', (d, i) => (shifts[i].width + this.options.columnPadding) + 'px')
      .style('left', (d, i) => shifts[i].offset + 'px')
      .style('background-color', (d) => d.color);
    $headers.attr('class', (d) => `${clazz} ${d.cssClass || ''} ${(d.getCompressed() ? 'compressed' : '')} ${d.headerCssClass} ${this.options.autoRotateLabels ? 'rotateable' : ''} ${d.isFiltered() ? 'filtered' : ''}`)
      .attr('title', (d) => toFullTooltip(d))
      .attr('data-id', (d) => d.id);
    $headers.select('i.sort_indicator').attr('class', (d) => {
      const r = d.findMyRanker();
      if (r && r.getSortCriteria().col === d) {
        return 'sort_indicator fa fa-sort-' + (r.getSortCriteria().asc ? 'asc' : 'desc');
      }
      return 'sort_indicator fa';
    });
    $headers.select('span.lu-label').text((d) => d.label);

    $headers.filter((d) => isMultiLevelColumn(d)).each(function (col: IMultiLevelColumn) {
      if (col.getCollapsed() || col.getCompressed()) {
        select(this).selectAll('div.' + clazz + '_i').remove();
      } else {
        let s_shifts = [];
        col.flatten(s_shifts, 0, 1, that.options.columnPadding);

        let s_columns = s_shifts.map((d) => d.col);
        that.renderColumns(s_columns, s_shifts, select(this), clazz + (clazz.substr(clazz.length - 2) !== '_i' ? '_i' : ''));
      }
    }).select('div.lu-label').call(dropAble(['application/caleydo-lineup-column-number-ref', 'application/caleydo-lineup-column-number'], (data, d: IMultiLevelColumn, copy) => {
      let col: Column = null;
      if ('application/caleydo-lineup-column-number-ref' in data) {
        const id = data['application/caleydo-lineup-column-number-ref'];
        col = this.data.find(id);
        if (copy) {
          col = this.data.clone(col);
        } else if (col) {
          col.removeMe();
        }
      } else {
        const desc = JSON.parse(data['application/caleydo-lineup-column-number']);
        col = this.data.create(this.data.fromDescRef(desc));
      }
      return d.push(col) != null;
    }));

    // drag columns on top of each
    $headers.filter((d) => d.parent instanceof Ranking && isNumberColumn(d) && !isMultiLevelColumn(d)).select('div.lu-label').call(dropAble(['application/caleydo-lineup-column-number-ref', 'application/caleydo-lineup-column-number'], (data, d: Column & INumberColumn, copy) => {
      let col: Column = null;
      if ('application/caleydo-lineup-column-number-ref' in data) {
        const id = data['application/caleydo-lineup-column-number-ref'];
        col = this.data.find(id);
        if (copy) {
          col = this.data.clone(col);
        } else if (col) {
          col.removeMe();
        }
      } else {
        const desc = JSON.parse(data['application/caleydo-lineup-column-number']);
        col = this.data.create(this.data.fromDescRef(desc));
      }
      const ranking = d.findMyRanker();
      const index = ranking.indexOf(d);
      const stack = <StackColumn>this.data.create(createStackDesc());
      d.removeMe();
      stack.push(d);
      stack.push(col);
      return ranking.insert(stack, index) != null;
    }));

    if (this.options.histograms) {

      $headers.filter((d) => isCategoricalColumn(d)).each(function (col: CategoricalColumn) {
        const $this = select(this).select('div.histogram');
        const hist = that.histCache.get(col.id);
        if (hist) {
          hist.then((stats: ICategoricalStatistics) => {
            const $bars_update = $this.selectAll('div.bar').data(stats.hist);
            const $bars = $bars_update.merge($bars_update.enter().append('div').classed('bar', true));
            const sx = scaleBand().domain(col.categories).range([0, 100]).paddingInner(0.1);
            const sy = scaleLinear().domain([0, stats.maxBin]).range([0, 100]);
            $bars.style('left', (d) => sx(d.cat) + '%')
              .style('width', (d) => sx.bandwidth() + '%')
              .style('top', (d) => (100 - sy(d.y)) + '%')
              .style('height', (d) => sy(d.y) + '%')
              .style('background-color', (d) => col.colorOf(d.cat))
              .attr('title', (d) => `${d.cat}: ${d.y}`)
              .attr('data-cat', (d) => d.cat);
            $bars_update.exit().remove();
          });
        }
      });
      $headers.filter((d) => d instanceof NumberColumn).each(function (col: Column) {
        const $this = select(this).select('div.histogram');
        const hist = that.histCache.get(col.id);
        if (hist) {
          hist.then((stats: IStatistics) => {
            const $bars_update = $this.selectAll('div.bar').data(stats.hist);
            const $bars = $bars_update.merge($bars_update.enter().append('div').classed('bar', true));
            const sx = scaleBand().domain(d3range(stats.hist.length).map(String)).range([0, 100]).paddingInner(0.1);
            const sy = scaleLinear().domain([0, stats.maxBin]).range([0, 100]);
            $bars.style('left', (d, i) => sx(String(i)) + '%')
              .style('width', (d, i) => sx.bandwidth() + '%')
              .style('top', (d) => (100 - sy(d.length)) + '%')
              .style('height', (d) => sy(d.length) + '%')
              .attr('title', (d, i) => `Bin ${i}: ${d.length}`)
              .attr('data-x', (d) => d.x0);
            $bars_update.exit().remove();

            let $mean = $this.select('div.mean');
            if ($mean.empty()) {
              $mean = $this.append('div').classed('mean', true);
            }
            $mean.style('left', (stats.mean * 100) + '%');
          });
        }
      });
    }

    $headers_update.exit().remove();
  }
}
