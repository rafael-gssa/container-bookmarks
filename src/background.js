const info = {
  preferences: {
    'show-popup': {
      name: 'Show popup when creating a bookmark.',
      defaultValue: true,
      value: true,
      type: 'checkbox',
    },
    'redirect-key': {
      name: 'Redirect Key:',
      description: 'The key that is used to trigger the redirect. For example, the default redirect key is "container", which appends "#container-%name%" to the end of the original URL and makes "http://www.%name%.container/%original-url%" the redirect URL.',
      defaultValue: 'container',
      value: 'container',
      type: 'text',
    },
  },
};
const bookmarks = {};

const wasInternallyCreated = new Set();

const createdBookmarks = new Map();

getPreferences().then(() => {
  browser.bookmarks.onCreated.addListener(onBookmarkCreated);
  if (info.preferences['show-popup'].value) {
    browser.bookmarks.onCreated.addListener(onBookmarkCreatedAndOpenPopup);
  }
  browser.bookmarks.onChanged.addListener(onBookmarkChanged);
  browser.bookmarks.onMoved.addListener(onBookmarkMoved);
  browser.menus.onClicked.addListener(onMenuClicked);
  browser.webRequest.onBeforeRequest.addListener(onBeforeRequest, {
    urls: ['<all_urls>'],
    types: ['main_frame'],
  }, ['blocking']);

  browser.runtime.onMessage.addListener(onMessageReceived);

  browser.menus.create({
    id: 'edit-bookmark',
    icons: {
      '48': 'icon.png',
    },
    title: 'Edit Container Bookmark',
    contexts: ['bookmark'],
  });
});

async function getPreferences() {
  try {
    const defaultValues = {};
    for (const key in info.preferences) {
      defaultValues[key] = info.preferences[key].defaultValue;
    }

    const values = await browser.storage.sync.get(defaultValues);

    for (const key in values) {
      info.preferences[key].value = values[key];
    }
  } catch (error) {
    console.log(error);
  }
}

async function onMessageReceived(message) {
  let response = null;

  switch (message.action) {
    case 'get-info': {
      await getPreferences();

      const currentFolders = [];
      const currentContainers = [];

      const tree = await browser.bookmarks.getTree();
      for (const node of tree[0].children) {
        const folder = getFolder(node);
        if (folder) {
          currentFolders.push(folder);
        }
      }

      const containers = await browser.contextualIdentities.query({});
      for (const container of containers) {
        currentContainers.push({
          id: getContainerId(container.name),
          name: container.name,
        });
      }

      const bookmark = bookmarks[message.id];
      const matches = bookmark.url.match(new RegExp(`#${info.preferences['redirect-key'].value}-(.*)`));
      bookmark.containerId = matches ? matches[1] : 'none';

      response = {
        ...info,
        folders: currentFolders,
        containers: currentContainers,
        bookmark,
      };

      delete bookmarks[message.id];

      break;
    }
    case 'get-preferences': {
      response = info.preferences;

      break;
    }
    case 'set-preferences': {
      await browser.storage.sync.set(message.preferences);

      await getPreferences();

      const hasListener = browser.bookmarks.onCreated.hasListener(onBookmarkCreatedAndOpenPopup);

      if (info.preferences['show-popup'].value && !hasListener) {
        browser.bookmarks.onCreated.addListener(onBookmarkCreatedAndOpenPopup);
      } else if (!info.preferences['show-popup'].value && hasListener) {
        browser.bookmarks.onCreated.removeListener(onBookmarkCreatedAndOpenPopup);
      }

      break;
    }
    case 'remove-bookmark': {
      if (await bookmarkExists(message.id)) {
        await browser.bookmarks.remove(message.id);
      }

      break;
    }
    case 'add-bookmark': {
      if (await bookmarkExists(message.id)) {
        if (message.old.title !== message.new.title || message.old.url !== message.new.url) {
          await browser.bookmarks.update(message.id, {
            title: message.new.title,
            url: message.new.url,
          });
        }

        if (message.old.parentId !== message.new.parentId) {
          await browser.bookmarks.move(message.id, {
            parentId: message.new.parentId,
          });
        }
      } else {
        wasInternallyCreated.add(message.id);

        await browser.bookmarks.create({
          title: message.new.title,
          url: message.new.url,
          parentId: message.new.parentId,
        });
      }

      break;
    }
    case 'resize-window': {
      if (await windowExists(message.windowId)) {
        await browser.windows.update(message.windowId, {
          width: message.width,
          height: message.height,
        });
      }

      break;
    }
  }

  return response;
}

async function getCurentContainers() {
  const containers = await browser.contextualIdentities.query({});

  const containersFromCookieStoreId = {};
  for (const container of containers) {
    containersFromCookieStoreId[container.cookieStoreId] = {
      id: getContainerId(container.name),
      name: container.name,
    };
  }
  return containersFromCookieStoreId;
}

// Set container for bookmarks created by the "Bookmark Tabs" command.
// The command creates bookmarks from tabs and remain tabs multiselected,
// thus we can map container tabs to created bookmarks if all these three
// conditions are satisfied:
//  1) Multiple bookmarks are created at a time.
//  2) The number of highlighted tabs in a window equals to the number of
//     created bookmarks.
//  3) All URLs of highlighted tabs are same to the of created bookmarks.
async function fillContainerFromTabs() {
  const bookmarks = Object.fromEntries(createdBookmarks.entries());
  createdBookmarks.clear();

  // Step 1: Create [URL] => [bookmarks] map
  const bookmarksFromUrl = {};
  for (const bookmark of Object.values(bookmarks)) {
    bookmarksFromUrl[bookmark.url] = [
      ...(bookmarksFromUrl[bookmark.url] || []),
      bookmark,
    ];
  }

  const [highlightedTabs, currentContainersFromCookieStoreId] = await Promise.all([
    browser.tabs.query({ highlighted: true }),
    getCurentContainers(),
  ]);

  // Step 2: Create [windowId] => [tabs] map and
  const tabsInWindow = {};
  for (const tab of highlightedTabs) {
    tabsInWindow[tab.windowId] = [
      ...(tabsInWindow[tab.windowId] || []),
      tab,
    ];
  }

  // Step 3: Detect corresponding tabs based on URLs, and
  // Step 4: Create [URL] => [tabs] map
  const bookmarkUrls = Array.from(Object.values(bookmarks), bookmark => bookmark.url).sort().join('\n');
  const tabsFromUrl = {};
  for (const [windowId, tabs] of Object.entries(tabsInWindow)) {
    if (tabs.map(tab => tab.url).sort().join('\n') != bookmarkUrls)
      continue;
    for (const tab of tabs) {
      tabsFromUrl[tab.url] = [
        ...(tabsFromUrl[tab.url] || []),
        tab,
      ];
    }
    break;
  }

  // Finally map tabs to bookmarks based on their URL
  const redirectoKey = info.preferences['redirect-key'].value;
  for (const [url, bookmarks] of Object.entries(bookmarksFromUrl)) {
    const tabs = tabsFromUrl[url];
    for (let i = 0, maxi = bookmarks.length; i < maxi; i++) {
      const tab = tabs[i];
      if (!tab.cookieStoreId || tab.cookieStoreId == 'firefox-default')
        continue;

      const bookmark = bookmarks[i];
      const containerId = currentContainersFromCookieStoreId[tab.cookieStoreId].id;
      const url = `${tab.url.replace(new RegExp(`#${redirectoKey}-(.*)`), '')}#${redirectoKey}-${containerId}`;
      if (url == bookmark.url)
        continue;

      browser.bookmarks.update(bookmark.id, { url });
    }
  }
}

function reserveToFillContainerFromTabs() {
  clearTimeout(reserveToFillContainerFromTabs.timer);
  reserveToFillContainerFromTabs.timer = setTimeout(fillContainerFromTabs, 500);
}
reserveToFillContainerFromTabs.timer = null;

function onBookmarkCreated(id, bookmark) {
  if (bookmark.type != 'bookmark')
    return;
  createdBookmarks.set(id, bookmark);
  reserveToFillContainerFromTabs();
}

async function openPopup(id, bookmark, isEdit) {
  if (bookmark.type === 'bookmark' || (bookmark.type === 'folder' && isEdit)) {
    const newBookmark = {};
    bookmarks[id] = newBookmark;

    newBookmark.id = id;
    newBookmark.name = bookmark.title;
    newBookmark.url = bookmark.url || '';
    newBookmark.parentId = bookmark.parentId;
    newBookmark.children = [];

    newBookmark.isFolder = bookmark.type === 'folder';
    newBookmark.isEdit = isEdit;

    if (newBookmark.isFolder) {
      const children = (await browser.bookmarks.getChildren(newBookmark.id))
        .filter(child => child.type === 'bookmark');
      for (const child of children) {
        newBookmark.children.push({
          id: child.id,
          name: child.title,
          url: child.url,
          parentId: child.parentId,

          isFolder: false,
          isEdit: true,
        });
      }

      if (newBookmark.children.length > 0) {
        newBookmark.url = newBookmark.children[0].url;
      }
    }

    const matches = newBookmark.url.match(new RegExp(`#${info.preferences['redirect-key'].value}-(.*)`));
    newBookmark.containerId = matches ? matches[1] : 'none';

    newBookmark.windowId = (await browser.windows.create({
      url: `${browser.runtime.getURL('./popup/popup.html')}#${id}`,
      type: 'popup',
      width: 375,
      height: 350,
    })).id;
  }
}

async function onBookmarkCreatedAndOpenPopup(id, bookmark, isEdit) {
  if (wasInternallyCreated.has(id)) {
    wasInternallyCreated.delete(id);
  } else {
    openPopup(id, bookmark, isEdit);
  }
}

async function onBookmarkChanged(id, changeInfo) {
  if (createdBookmarks.has(id)) {
    createdBookmarks.set(id, {
      ...createdBookmarks[id],
      ...changeInfo,
    });
  }

  const bookmark = bookmarks[id];
  if (bookmark) {
    if ('title' in changeInfo)
      bookmark.name = changeInfo.title;
    if ('url' in changeInfo)
      bookmark.url = changeInfo.url;
  }

  const responded = await browser.runtime.sendMessage({
    action: 'check-popup-existence-for-bookmark',
    id
  });
  if (responded) {
    const changes = {};
    if ('title' in changeInfo)
      changes.name = changeInfo.title;
    if ('url' in changeInfo) {
      changes.url = changeInfo.url;
      const matches = changeInfo.url.match(new RegExp(`#${info.preferences['redirect-key'].value}-(.*)`));
      changes.containerId = matches ? matches[1] : 'none';
    }
    browser.runtime.sendMessage({
      action: 'bookmark-changed',
      id,
      ...changes,
    });
  }
}

async function onBookmarkMoved(id, moveInfo) {
  if (createdBookmarks.has(id))
    createdBookmarks.get(id).parentId = moveInfo.parentId;

  const bookmark = bookmarks[id];
  if (bookmark)
    bookmark.parentId = moveInfo.parentId;

  const responded = await browser.runtime.sendMessage({
    action: 'check-popup-existence-for-bookmark',
    id
  });
  if (responded) {
    const tree = await browser.bookmarks.getTree();
    const folders = [];
    for (const node of tree[0].children) {
      const folder = getFolder(node);
      if (folder) {
        folders.push(folder);
      }
    }
    browser.runtime.sendMessage({
      action: 'bookmark-moved',
      id,
      parentId: moveInfo.parentId,
      folders,
    });
  }
}

async function onMenuClicked(menuInfo) {
  if (menuInfo.menuItemId === 'edit-bookmark') {
    const bookmark = (await browser.bookmarks.get(menuInfo.bookmarkId))[0];
    openPopup(bookmark.id, bookmark, true);
  }
}

function onBeforeRequest(details) {
  const response = {};

  const url = details.url;

  const matches = url.match(new RegExp(`((.*)#${info.preferences['redirect-key'].value}-(.*))|(http://(www\.)?.*\.${info.preferences['redirect-key'].value}\/(.*))`));
  if (matches) {
    if (matches[1]) {
      response.redirectUrl = `http://www.${matches[3]}.${info.preferences['redirect-key'].value}/${matches[2]}`;
    } else if (matches[4]) {
      response.redirectUrl = matches[6];
    }
  }

  return response;
}

/**
 * @param {NodeDetails} node
 * @return {OptionDetails}
 */
function getFolder(node) {
  let folder = null;

  if (node.type === 'folder') {
    folder = {
      id: node.id,
      name: node.title,
    };

    if (node.children) {
      folder.children = [];

      for (const childNode of node.children) {
        const childFolder = getFolder(childNode);
        if (childFolder) {
          folder.children.push(childFolder);
        }
      }
    }
  }

  return folder;
}

/**
 * @param {String} name
 * @return {String}
 */
function getContainerId(name) {
  return name
    .toLowerCase()
    .replace(/\s/g, '-');
}

/**
 * @param {String} id
 * @return {Promise<Boolean>}
 */
async function bookmarkExists(id) {
  let exists = false;

  try {
    exists = !!(await browser.bookmarks.get(id))[0];
  } catch (error) {
    console.log(error);
  }

  return exists;
}

/**
 * @param {String} id
 * @return {Promise<Boolean>}
 */
async function windowExists(id) {
  let exists = false;

  try {
    exists = !!(await browser.windows.get(id));
  } catch (error) {
    console.log(error);
  }

  return exists;
}