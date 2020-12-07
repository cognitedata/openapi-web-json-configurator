import { DataType } from "../enum/DataType.enum";
import { ISchemaNode } from "../interfaces/ISchemaNode";
import { rootDataNode } from "../Validator";
import { BooleanNode } from "./BooleanNode";
import { StringNode } from "./StringNode";

export type BaseNodes = { [key: string]: BaseNode };
export type IData =
  | BaseNodes
  | BaseNode[]
  | string
  | number
  | boolean
  | undefined;
export type Discriminator = {
  mapping: { [key: string]: string };
  propertyName: string;
};

export class BaseNode {
  public type?: DataType;
  public description?: string;
  public _data: IData;
  public isRequired?: boolean;
  public readOnlyFields: string[] = [];
  public discriminator?: Discriminator;

  constructor(
    type: DataType,
    schema: ISchemaNode,
    data: IData,
    isRequired: boolean
  ) {
    this.type = type;
    this.description = schema.description;
    this.discriminator = schema.discriminator;
    // This rule overrides the data comes from constructor. But this is ok for now since we are using these logics for creating taplate nodes.
    this._data = schema.example ?? data;
    this.isRequired = isRequired;
  }

  public get data(): IData {
    if (this.discriminator) {
      const result: BaseNodes = {};

      for (const [key, val] of Object.entries(this.discriminator.mapping)) {
        const schemaPath = val.split("/");
        const node = rootDataNode[schemaPath[schemaPath.length - 1]];
        if(!node.readOnlyFields.includes(this.discriminator.propertyName)){
          node.readOnlyFields.push(this.discriminator.propertyName);
        }
        if(node._data instanceof Object){
          (node._data as any)[this.discriminator.propertyName] = {
            type: 'string',
            data: key
          };
        }
        result[key] = node;
      }
      return result;
    } else {
      return this._data;
    }
  }
}
