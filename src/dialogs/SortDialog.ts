import Column from '../model/Column';
import ADialog from './ADialog';
import {IBoxPlotColumn, SORT_METHOD} from '../model/BoxPlotColumn';
import { event as d3event, selectAll } from 'd3';

export default class SortDialog extends ADialog {
  constructor(private readonly column: IBoxPlotColumn, $header: d3.Selection<Column>, title: string = 'Edit Weights') {
    super($header, title);
  }

  openDialog() {
    const bak = this.column.getSortMethod();
    const valueString = Object.keys(SORT_METHOD);

    const popup = this.makeSortPopup(valueString.map((d) => {
      return `<input type="radio" name="multivaluesort" value=${d}  ${(bak === d) ? 'checked' : ''} > ${d.slice(0,1).toUpperCase() + d.slice(1)} <br>`;
    }).join('\n'));

    const sortContent = selectAll('input[name=multivaluesort]');
    sortContent.on('change', () => {
      const target = (<MouseEvent>d3event).target;
      const value = (<HTMLInputElement>target).value;
      this.column.setSortMethod(value);
    });

    this.hidePopupOnClickOutside(popup, sortContent);
  }

}
