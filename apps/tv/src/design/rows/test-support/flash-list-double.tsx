// A test double for `@shopify/flash-list` 2.3.3 (frozen with T3-08). Each frozen file that renders a row starts with
// `jest.mock("@shopify/flash-list", () => require("./test-support/flash-list-double"))`.
//
// `FlashList` renders one host `View` under the given `testID` with every prop it was given spread on it, except
// `data`, `renderItem` and `ListHeaderComponent`. So a test reads `horizontal`, `drawDistance`,
// `maintainVisibleContentPosition`, `keyExtractor`, `getItemType` and `onScroll` from that element, and can call the
// two functions. Inside the View it renders the header, then every item through `renderItem`. Its ref exposes
// `scrollToOffset`, `scrollToIndex` and `scrollToItem` as jest.fn()s, recorded per testID.
import { jest } from "@jest/globals";
import { Fragment, createElement, forwardRef, isValidElement, useImperativeHandle } from "react";
import type { ComponentType, ReactElement, ReactNode } from "react";
import { View } from "react-native";

type Methods = {
  scrollToOffset: ReturnType<typeof jest.fn>;
  scrollToIndex: ReturnType<typeof jest.fn>;
  scrollToItem: ReturnType<typeof jest.fn>;
};

const registry = new Map<string, Methods>();

function methodsFor(testID: string): Methods {
  let methods = registry.get(testID);
  if (methods === undefined) {
    methods = { scrollToOffset: jest.fn(), scrollToIndex: jest.fn(), scrollToItem: jest.fn() };
    registry.set(testID, methods);
  }
  return methods;
}

/** The arguments of every `scrollToOffset` call on the list with this testID, in order. */
export function scrollCalls(testID: string): unknown[] {
  return (registry.get(testID)?.scrollToOffset.mock.calls ?? []).map((call) => call[0]);
}

/** Clears the recorded calls. The lists stay registered, so a list that is still mounted keeps recording. */
export function resetScrollCalls(): void {
  for (const methods of registry.values()) {
    methods.scrollToOffset.mockClear();
    methods.scrollToIndex.mockClear();
    methods.scrollToItem.mockClear();
  }
}

type Props = {
  testID?: string;
  data?: readonly unknown[] | null;
  renderItem?: (info: { item: any; index: number; target: "Cell" }) => ReactNode;
  keyExtractor?: (item: any, index: number) => string;
  ListHeaderComponent?: ReactElement | ComponentType | null;
  [key: string]: unknown;
};

export const FlashList = forwardRef<unknown, Props>(function FlashListDouble(props, ref) {
  const { data, renderItem, ListHeaderComponent, keyExtractor, testID, ...rest } = props;
  const id = testID ?? "flash-list";
  useImperativeHandle(ref, () => methodsFor(id), [id]);
  let header: ReactNode = null;
  if (isValidElement(ListHeaderComponent)) header = ListHeaderComponent;
  else if (ListHeaderComponent) header = createElement(ListHeaderComponent as ComponentType);
  return (
    <View testID={testID} keyExtractor={keyExtractor} {...(rest as object)}>
      {header}
      {(data ?? []).map((item, index) => (
        <Fragment key={keyExtractor ? keyExtractor(item, index) : index}>{renderItem?.({ item, index, target: "Cell" })}</Fragment>
      ))}
    </View>
  );
});
