/* Text link element capturing link text and destination target URL. */
export interface TextLink {
  text: string;
  url: string;
}

/* Base interface for all provider-neutral AST elements. */
export interface BaseNeutralElement {
  type: string;
  links?: TextLink[];
}

/* Heading element with level indicator (1, 2, or 3). */
export interface NeutralHeading extends BaseNeutralElement {
  type: 'heading';
  level: 1 | 2 | 3;
  text: string;
}

/* Paragraph element with extracted readable text and associated links. */
export interface NeutralParagraph extends BaseNeutralElement {
  type: 'paragraph';
  text: string;
}

/* List item element with order flag and optional nested child elements. */
export interface NeutralListItem extends BaseNeutralElement {
  type: 'list_item';
  ordered: boolean;
  text: string;
  children?: NeutralElement[];
}

/* Task item element capturing task text, completion state, and optional nested child elements. */
export interface NeutralTask extends BaseNeutralElement {
  type: 'task';
  text: string;
  checked: boolean;
  children?: NeutralElement[];
}

/* Container element capturing toggle labels or structural containers with nested child elements. */
export interface NeutralContainer extends BaseNeutralElement {
  type: 'container';
  label: string;
  children: NeutralElement[];
}

/* Discriminated union of all supported provider-neutral AST elements. */
export type NeutralElement =
  | NeutralHeading
  | NeutralParagraph
  | NeutralListItem
  | NeutralTask
  | NeutralContainer;
