import JSONEditor, {
    AutoCompleteElementType,
    JSONEditorMode,
    JSONEditorOptions,
    JSONPath,
    MenuItem,
    MenuItemNode,
    ValidationError
} from "jsoneditor";
import isBoolean from "lodash-es/isBoolean";
import isString from "lodash-es/isString";
import { getNodeMeta, getAllNodes, removeNode } from "../validator/Validator";
import { ErrorType } from "../validator/interfaces/IValidationResult";
import { StringNode } from "../validator/nodes/StringNode";
import { JsonConfigCommandCenter } from "./JsonConfigCommandCenter";
import { MapNode } from "../validator/nodes/MapNode";
import { BaseNode, BaseNodes, IData } from "../validator/nodes/BaseNode";
import { ArrayNode } from "../validator/nodes/ArrayNode";
import { DataType } from "../validator/enum/DataType.enum";
import { getJson, replaceString } from "../validator/util/Helper";
import message from 'antd/es/message';
import { LOCALIZATION } from '../constants'

const extractField = (key: string) => {
    return key.split(":")[1]
}

export class CogniteJsonEditorOptions implements JSONEditorOptions {

    public get options(): JSONEditorOptions {

        return {
            mode: this.mode,
            // modes: this.modes,
            templates: this.templates,
            autocomplete: this.autocomplete,
            enableSort: this.enableSort,
            indentation: this.indentation,
            escapeUnicode: this.escapeUnicode,
            enableTransform: this.enableTransform,
            onCreateMenu: ((menuItems: MenuItem[], node: MenuItemNode) => {
                return this.onCreateMenu(menuItems, node);
            }),
            onValidate: this.onValidate,
            onChange: this.onChange,
            onError: this.onError
        }
    }

    public mode: "tree" | "code" | "preview" | undefined = 'tree';

    public modes: JSONEditorMode[] = ["tree", "code"];

    public get templates(): any {
        const allTemplates: any = [];
        getAllNodes().forEach(ele => {
            const key = extractField(ele.key);
            const template = {
                text: key,
                title: ele.node.description,
                className: 'jsoneditor-type-object',
                field: key,
                value: ele.data
            }
            allTemplates.push(template);

            if (ele.node.discriminator && ele.node.data) {
                // If discriminator exists, add all sub types as templates
                Object.entries(ele.node.data).forEach(([subKey, subVal]) => {
                    const template = {
                        text: `${key}-${subKey}`,
                        title: `Add sample item to ${key}`,
                        className: "jsoneditor-type-object",
                        field: `${key}`,
                        value: getJson(subVal as BaseNode),
                    };
                    allTemplates.push(template);
                });
            }

            if (ele.node.type === DataType.array || ele.node.type === DataType.map) {
                const template = {
                    text: `${key}-sample`,
                    title: `Add sample item to ${key}`,
                    className: 'jsoneditor-type-object',
                    field: `${key}-sample`,
                    value: ele.sample
                }
                allTemplates.push(template);
            }
        });
        return allTemplates;
    }

    // remove unwanted items from top Command Bar
    public enableSort = false;
    public enableTransform = false;

    public indentation = 4;
    public escapeUnicode = true;

    public onCreateMenu(menuItems: MenuItem[], node: MenuItemNode): any[] {
        const currentJson = JsonConfigCommandCenter.currentJson;
        const path = node.path;
        // get parent Path for add function
        const parentPath: string[] = [...path];
        // Skip case: adding first child
        if (node.type !== "append") {
            parentPath.pop();
        }

        const removePossibility = removeNode(currentJson, [...path]);

        // Creating a new MenuItem array that only contains valid items
        // and replace submenu with valid items
        menuItems.forEach(item => {
            if (item.text === "Insert") {
                item.click = undefined;
                item.submenu = this.createValidInsertMenu(item.submenu, currentJson, parentPath);
            }
            // adding same logic to Append
            else if (node.type === "append" && item.text === "Append") {
                item.text = "Insert";
                item.click = undefined;
                item.submenu = this.createValidInsertMenu(item.submenu, currentJson, parentPath);
            }

            // if removeNode validation returns error
            // Remove default Remove(Delete) function and alert the error
            // except for ErrorType.InvalidPath
            else if (item.text === "Remove") {
                item.title = LOCALIZATION.REMOVE_ENABLED;
                if (removePossibility.error) {
                    // allows Remove even it has InvalidPath error
                    if (removePossibility.error.type === ErrorType.InvalidPath) {
                        item.title = LOCALIZATION.REMOVE_INVALID_PATH;
                    } else {
                        item.className = "warning-triangle";
                        switch (removePossibility.error.type) {
                            case ErrorType.RequiredNode:
                                item.title = LOCALIZATION.REMOVE_MANDATORY;
                                item.click = () => {
                                    message.error(LOCALIZATION.REMOVE_MANDATORY);
                                }
                                break;
                            case ErrorType.MinLength:
                                item.title = LOCALIZATION.REMOVE_MINIMUM_LENGTH;
                                item.click = () => {
                                    message.error(LOCALIZATION.REMOVE_MINIMUM_LENGTH);
                                }
                                break;
                            default:
                                item.title = LOCALIZATION.REMOVE_DISABLED;
                                item.click = () => {
                                    message.error(LOCALIZATION.REMOVE_DISABLED);
                                }
                                break;
                        }
                    }
                }
            }
        });

        // remove unwanted menu items
        menuItems = menuItems.filter(item => {
            return item.text !== "Type" &&
                item.text !== "Sort" &&
                item.text !== "Transform" &&
                item.text !== "Extract" &&
                item.text !== "Duplicate" &&
                item.text !== "Append" &&
                item.type !== "separator"
        })

        return menuItems;
    }

    public get autocomplete(): any {
        return {
            filter: 'start',
            trigger: 'focus',
            getOptions: (text: string, path: JSONPath, input: AutoCompleteElementType, editor: JSONEditor) => {
                return new Promise((resolve, reject) => {
                    const rootJson = JSON.parse(editor.getText());
                    const { resultNode } = getNodeMeta([...path], rootJson);

                    if (resultNode && resultNode.type === DataType.string) {
                        const stringNode = resultNode as StringNode;
                        if (stringNode.possibleValues && stringNode.possibleValues.length > 0) {
                            resolve(stringNode.possibleValues)
                        } else {
                            reject()
                        }
                    }
                });
            }
        };
    }

    public onChange = (): void => {
        JsonConfigCommandCenter.updateTitle();
    }

    public onError = (err: any): void => {
        if(err) {
            message.error(err.message);
        }
    }


    public onValidate = (json: any): ValidationError[] | Promise<ValidationError[]> => {

        const schemaMeta = getNodeMeta([], json).resultNode; // meta of root node from schema
        const errors = this.validateFields(json, schemaMeta);

        return errors;
    }

    /**
     * Validates if
     * 1. All required keys from schema are available
     * 2. there are no invalid keys
     * 3. Discriminate properties are available and follows the schema
     * @param json
     * @param schemaMeta
     * @param discriminator
     * @param paths
     * @param errors
     * @private
     */
    private validateFields(json: any, schemaMeta: any, paths: any[] = [], errors: ValidationError[] = []): ValidationError[] {

        const missingRequiredFields = [];
        const validatedKeys = new Set<string>();
        const schemaType = schemaMeta.type;
        let schemaMetaData: any;
        const discriminator = schemaMeta.discriminator;

        if(discriminator) {
            if(schemaType === DataType.object) {
                schemaMetaData = schemaMeta.data;
            } else if (schemaType === DataType.array || schemaType === DataType.map) {
                schemaMetaData = schemaMeta.sampleData;
            }
            const discriminatorErrors = this.validateDiscriminator(json, schemaMetaData, discriminator, paths);
            errors = discriminatorErrors.concat(errors);
        } else {
            switch (schemaType) {
                case DataType.object: {
                    schemaMetaData = schemaMeta.data;

                    for (const childKey of Object.keys(schemaMetaData)) {
                        const childValue = json[childKey];
                        const childPath = paths.concat([childKey]);
                        const childMeta = schemaMetaData[childKey];

                        const isChildKeyRequired = childMeta.isRequired;

                        const hasKey = Object.prototype.hasOwnProperty.call(json, childKey);

                        if (!hasKey) {
                            if (isChildKeyRequired) {
                                missingRequiredFields.push(childKey);
                            }
                        } else {
                            validatedKeys.add(childKey);

                            const childErrors = this.validateFields(childValue, childMeta, childPath);
                            errors = childErrors.concat(errors);

                        }
                    }

                    for (const jsonChildKey of Object.keys(json)) { // validate unnecessary fields
                        if (!validatedKeys.has(jsonChildKey)) {
                            const newPath = paths.concat([jsonChildKey]);
                            errors.push({ path: newPath, message: replaceString(LOCALIZATION.NOT_VALID_KEY, jsonChildKey) });
                        }
                    }
                    break;
                }
                case DataType.map:
                case DataType.array: {

                    if(schemaType === DataType.array) {
                        const arrayValidationErrors =  this.validateArray(json, schemaMeta, paths);
                        errors = arrayValidationErrors.concat(errors);
                    }

                    schemaMetaData = schemaMeta.sampleData;

                    const callNextIteration = (childKey: any, childValue: any) => {
                        const childPath = paths.concat([childKey]);

                        const childErrors = this.validateFields(childValue, schemaMetaData, childPath);
                        errors = childErrors.concat(errors);
                    }

                    if (schemaType === DataType.map) {
                        for (const mapChildKey of Object.keys(json)) {
                            const mapChild = json[mapChildKey];
                            callNextIteration(mapChildKey, mapChild);
                        }
                    } else {
                        for (let i = 0; i < json.length; i++) {
                            const mapChild = json[i];
                            callNextIteration(i, mapChild);
                        }
                    }

                    break;
                }
                default: {
                    schemaMetaData = schemaMeta;
                    const valueErrors =  this.validateValues(json, schemaMetaData, paths);
                    errors = valueErrors.concat(errors);
                }
            }
        }


        if (missingRequiredFields.length >= 1) {
            if(missingRequiredFields.length === 1) {
                errors.push({ path: paths, message: replaceString(LOCALIZATION.REQUIRED_FIELD_NOT_AVAIL, missingRequiredFields[0]) });
            } else {
                errors.push({ path: paths, message: replaceString(LOCALIZATION.REQUIRED_FIELDS_NOT_AVAIL, missingRequiredFields.join(',')) });
            }
        }

        return errors;
    }

    private validateArray(json: any, schema: any, paths: any, errors: ValidationError[] = []) {

        if(schema.type === DataType.array) {
            const maxItems = Number(schema.maxItems);
            const minItems = Number(schema.minItems);

            const elementCount = json.length;
            if(!isNaN(maxItems)) {
                if(maxItems >= 0) {
                    if(elementCount > maxItems) {
                        errors.push({ path: paths, message: replaceString(LOCALIZATION.MAX_ARR_ELEMENTS_EXCEEDED, maxItems.toString()) });
                    }
                } else {
                    console.error(`Invalid maxElement configuration for ${paths.join(".")}`);
                }
            }
            if(!isNaN(minItems)) {
                if(minItems >= 0 ) {
                    if(elementCount < minItems) {
                        errors.push({ path: paths, message: replaceString(LOCALIZATION.MIN_ARR_ELEMENTS_NOT_FOUND, minItems.toString()) });
                    }
                } else {
                    console.error(`Invalid minElement configuration for ${paths.join(".")}`);
                }
            }
        } else {
            console.error(`Schema type: ${schema.type} cannot be validated as an array!`);
        }
        return errors;
    }

    private validateDiscriminator(json: any, schema: any, discriminator: { propertyName: string }, paths: any[], errors: ValidationError[] = []): ValidationError[] {
        const discriminatorType = json[discriminator.propertyName];

        if (discriminatorType) { // whether discriminator property is available
            const discriminatorMeta = schema[discriminatorType];
            if (discriminatorMeta) {
                const childErrors = this.validateFields(json, discriminatorMeta, paths);
                errors = childErrors.concat(errors);
            } else {
                errors.push({ path: paths, message: replaceString(LOCALIZATION.DISCRIM_INVALID_TYPE, discriminator.propertyName) });
            }
        } else {
            errors.push({ path: paths, message: replaceString(LOCALIZATION.REQUIRED_FIELD_NOT_AVAIL, discriminator.propertyName) });
        }
        return errors;
    }

    private validateValues(value: string | boolean | number | null | undefined, schema: any, paths: any[], errors: ValidationError[] = []) : ValidationError[] {
        if(schema) {
            const datatype: DataType = schema.type;
            const possibleValues = schema.possibleValues;
            const isRequired = schema.isRequired;

            if(!value && value !== 0) {
                if(isRequired) {
                    errors.push({ path: paths, message: LOCALIZATION.VAL_NOT_BE_EMPTY });
                }
            } else {
                if(possibleValues && possibleValues.length) {
                    let isOneOfPossibleValues = false;
                    for(const possibleVal of possibleValues) {
                        if(value === possibleVal) {
                            isOneOfPossibleValues = true;
                        }
                    }
                    if(!isOneOfPossibleValues) {
                        errors.push({ path: paths, message: LOCALIZATION.VAL_NOT_OF_POSSIBLE_VALS });
                    }
                }
                switch (datatype) {
                    case DataType.number: {
                        const minimum = schema.minimum;
                        const maximum = schema.maximum;
                        if(isNaN(Number(value))) {
                            errors.push({ path: paths, message: LOCALIZATION.VAL_NOT_NUMBER });
                        } else {
                            if(minimum) {
                                if(value < minimum) {
                                    errors.push({ path: paths, message: replaceString(LOCALIZATION.VAL_CANNOT_BE_LESS, minimum) });
                                }
                            }
                            if(maximum) {
                                if(value > maximum) {
                                    errors.push({ path: paths, message: replaceString(LOCALIZATION.VAL_CANNOT_BE_GREATER, maximum) });
                                }
                            }
                        }
                        break;
                    }
                    case DataType.boolean:{
                        if(!isBoolean(value)) {
                            errors.push({ path: paths, message: LOCALIZATION.VAL_NOT_BOOLEAN });
                        }
                        break;
                    }
                    case DataType.string:{
                        if(!isString(value)) {
                            errors.push({ path: paths, message: LOCALIZATION.VAL_NOT_STRING });
                        }
                        break;
                    }
                }
            }
        }
        return errors;
    }

    private createValidInsertMenu(submenu: MenuItem[] | undefined, currentJson: any, parentPath: (string | number)[]): any {
        const validMenuItems: MenuItem[] = [];
        const { resultNode, error } = getNodeMeta([...parentPath], currentJson);

        if (error) {
            message.error(LOCALIZATION.INCONSISTENT_VALUE);
            return undefined;
        }

        const validInsertItems: any = this.getValidInsertItems(parentPath, currentJson, resultNode);
        const existingKeys: (number | string)[] = Object.keys(this.getPathObject(currentJson, [...parentPath]));

        if (submenu === undefined || submenu.length === 0) {
            return undefined;
        }

        submenu?.forEach(subItem => {
            if (validInsertItems !== undefined && validInsertItems.length !== 0) {
                Object.keys(validInsertItems).forEach((key: any) => {
                    if ((subItem.text === key)
                        && (subItem.title === validInsertItems[key].description)
                        // For discriminator types, if any key is added with base type, it needs to be filtered out.
                        && !existingKeys.includes(key.split('-')[0])) {
                        validMenuItems.push(subItem);
                        existingKeys.push(key);
                    }
                });
            }
        });

        return validMenuItems;
    }

    private getPathObject(json: any, path: (number | string)[]): any {
        let subTree = json;
        path.forEach((step: number | string) => {
            subTree = subTree[step];
        });
        return subTree;
    }

    // TODO: Re-implement this method with recursive calls
    private getValidInsertItems(parentPath: (string | number)[], currentJson: any, node: BaseNode | undefined | null): IData {
        const key = parentPath[parentPath.length - 1]
        let resultNode = node;

        /**
         * If dicriminator, resultNode should get from data[`type`]
         */
        if (resultNode?.discriminator) {
            const currentData = this.getPathObject(currentJson, parentPath);
            const typeIndicatorKey = resultNode.discriminator.propertyName;
            const dataType = currentData[typeIndicatorKey];
            resultNode = (resultNode.data as BaseNodes)[dataType];
        }

        /**
         * When adding items to an Array or a Map,
         * returning a IData object with matching key and description
         */
        if (resultNode instanceof ArrayNode || resultNode instanceof MapNode) {
            // TODO: Refactor/Test this code. This might fail when a discriminator type comes inside an Array or Map
            if (resultNode.sampleData?.discriminator) {
                // TODO: Check is this possible for other type of nodes
                return resultNode.sampleData.data;
            }
            const ret: BaseNodes = {
                [`${key}-sample`]: new BaseNode(DataType.unspecified, {
                    type: DataType.object,
                    description: `Add sample item to ${key}`
                }, undefined, true)
            }
            return ret;

        } else if (resultNode?.data) {
            // Since some nodes might be deleted by the logic below, this object must be cloned.
            const res: any = { ...(resultNode.data as BaseNodes) };

            Object.entries(res as Record<string, unknown>).forEach(
                ([key, node]) => {
                    if ((node as BaseNode).discriminator) {
                        delete res[key];
                        Object.keys(
                            (node as BaseNode).data as Record<string, unknown>
                        ).forEach((desKey) => {
                            res[`${key}-${desKey}`] = {
                                description: `Add sample item to ${key}`,
                            };
                        });
                    }
                }
            );
            return res;
        } else {
            message.error(LOCALIZATION.INCONSISTENT_VALUE);
            return undefined;
        }
    }
}
