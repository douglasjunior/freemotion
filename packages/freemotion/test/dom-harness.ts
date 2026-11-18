/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';


export type DomHarness = {
  render: (element: ReactElement, existingRoot?: Root) => Root;
};

export function createDomHarness(): DomHarness {
  const noop = () => undefined;

  const createNode = (tag = 'div') => {
    const children: any[] = [];
    return {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      nodeName: tag.toUpperCase(),
      style: {},
      attributes: {} as Record<string, string>,
      childNodes: children,
      children,
      setAttribute(k: string, v: string) {
        this.attributes[k] = v;
      },
      getAttribute(k: string) {
        return this.attributes[k];
      },
      removeAttribute(k: string) {
        delete this.attributes[k];
      },
      appendChild(c: any) {
        c.parentNode = this;
        children.push(c);
        return c;
      },
      removeChild(c: any) {
        const i = children.indexOf(c);
        if (i !== -1) {
          children.splice(i, 1);
        }
        c.parentNode = null;
        return c;
      },
      insertBefore(c: any, ref: any) {
        const i = children.indexOf(ref);
        if (i !== -1) {
          children.splice(i, 0, c);
        } else {
          children.push(c);
        }
        c.parentNode = this;
        return c;
      },
      addEventListener: noop,
      removeEventListener: noop,
      ownerDocument: null as any,
    };
  };

  class Node {}
  class Element extends Node {}
  class HTMLElement extends Element {}
  class HTMLIFrameElement extends HTMLElement {}

  const doc: any = {
    nodeType: 9,
    createElement: (tag: string) => {
      const node = createNode(tag);
      node.ownerDocument = doc;
      return node;
    },
    createElementNS: (_ns: string, tag: string) => {
      const node = createNode(tag);
      node.ownerDocument = doc;
      return node;
    },
    createTextNode: (text: string) => ({
      nodeType: 3,
      nodeValue: text,
      data: text,
      ownerDocument: doc,
    }),
    createComment: (text: string) => ({
      nodeType: 8,
      nodeValue: text,
      data: text,
      ownerDocument: doc,
    }),
    addEventListener: noop,
    removeEventListener: noop,
    documentElement: createNode('html'),
    body: createNode('body'),
    defaultView: null as any,
  };
  doc.documentElement.ownerDocument = doc;
  doc.body.ownerDocument = doc;

  const win: any = {
    document: doc,
    addEventListener: noop,
    removeEventListener: noop,
    Node,
    Element,
    HTMLElement,
    HTMLIFrameElement,
  };
  doc.defaultView = win;

  (globalThis as any).window = win;
  (globalThis as any).document = doc;
  (globalThis as any).Node = Node;
  (globalThis as any).Element = Element;
  (globalThis as any).HTMLElement = HTMLElement;
  (globalThis as any).HTMLIFrameElement = HTMLIFrameElement;

  return {
    render(element: ReactElement, existingRoot?: Root): Root {
      const container = doc.createElement('div');
      const root = existingRoot ?? createRoot(container);
      flushSync(() => {
        root.render(element);
      });
      return root;
    },
  };
}
