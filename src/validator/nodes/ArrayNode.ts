import { DataType } from "../enum/DataType.enum";
import { ISchemaNode } from "../interfaces/ISchemaNode";
import { BaseNode, BaseNodes, IData } from "./BaseNode";

export class ArrayNode extends BaseNode {
  public minItems?: number | undefined;
  public maxItems?: number | undefined;
  public sampleData: BaseNode | BaseNodes| undefined;

  constructor(schema: ISchemaNode, data: IData, isRequired: boolean, sampleData?: BaseNodes | BaseNode) {
    super(DataType.array, schema, [], isRequired);
    this.minItems = schema.minItems;
    this.maxItems = schema.maxItems;
    this.data = data;

    this.sampleData = sampleData;


    // if (schema.items) {
    //   this.sampleData = sampleData;

    //   if (this.minItems) {
    //     for (let i = 0; i < this.minItems; i++) {
    //       (this.data as BaseNode[]).push(this.sampleData);
    //     }
    //   }
    // }
  }
}
