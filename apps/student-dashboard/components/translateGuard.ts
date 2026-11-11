/**
 * @file apps/student-dashboard/components/translateGuard.ts
 * @description Keeps the dashboard working when a browser translates the page.
 *
 * Chrome's built-in translation (and similar extensions) wraps the page's text nodes in its own
 * <font> elements. When React later removes or inserts next to one of those text nodes, the node is
 * no longer a direct child of the parent React expects, the DOM call throws ("Failed to execute
 * 'removeChild' on 'Node'"), and the whole page fails with "Application error". Students rely on
 * translation, so instead of opting the page out of it, these two DOM methods are made tolerant of
 * nodes that translation has moved. See https://github.com/facebook/react/issues/11538.
 *
 * Imported once from _app.tsx for its side effect; does nothing on the server.
 */

if (typeof window !== 'undefined' && typeof Node === 'function' && Node.prototype) {
    const originalRemoveChild = Node.prototype.removeChild;
    Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
        if (child.parentNode !== this) {
            // Translation moved the node inside a wrapper: remove it from wherever it is now.
            if (child.parentNode) originalRemoveChild.call(child.parentNode, child);
            return child;
        }
        return originalRemoveChild.call(this, child) as T;
    };

    const originalInsertBefore = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function <T extends Node>(this: Node, newNode: T, referenceNode: Node | null): T {
        if (referenceNode && referenceNode.parentNode !== this) {
            // Insert before the wrapper that now holds the reference node, or at the end if there is none.
            let anchor: Node | null = referenceNode;
            while (anchor && anchor.parentNode !== this) anchor = anchor.parentNode;
            return originalInsertBefore.call(this, newNode, anchor) as T;
        }
        return originalInsertBefore.call(this, newNode, referenceNode) as T;
    };
}

export {};
