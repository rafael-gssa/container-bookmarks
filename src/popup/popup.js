let info = {};

const titleHeader = document.getElementById('title-header');
const nameField = document.getElementById('name-field');
const urlField = document.getElementById('url-field');
const folderDropdown = document.getElementById('folder-dropdown');
const containerDropdown = document.getElementById('container-dropdown');
const warningSection = document.getElementById('warning-section');
const warningLink = document.getElementById('warning-link');
const cancelButton = document.getElementById('cancel-button');
const doneButton = document.getElementById('done-button');

containerDropdown.addEventListener('change', onContainerDropdownChanged);
cancelButton.addEventListener('click', onCancelButtonClicked);
doneButton.addEventListener('click', onDoneButtonClicked);
browser.runtime.onMessage.addListener(onMessageReceived);

getInfo();

async function getInfo() {
  try {
    const id = location.hash.replace(/^#/, '');
    info = await browser.runtime.sendMessage({
      action: 'get-info',
      id
    });

    let title = '';
    if (info.bookmark.isFolder) {
      title = 'Edit Container Folder';
    } else if (info.bookmark.isEdit) {
      title = 'Edit Container Bookmark';
    } else {
      title = 'New Container Bookmark';
    }
    document.title = title;
    titleHeader.textContent = title;

    nameField.value = info.bookmark.name;
    if (info.bookmark.isFolder) {
      urlField.setAttribute('disabled', 'true');
    } else {
      urlField.value = info.bookmark.url;
    }

    addOptions(folderDropdown, info.folders);
    addOptions(containerDropdown, info.containers);

    folderDropdown.value = info.bookmark.parentId;
    containerDropdown.value = info.bookmark.containerId;

    onContainerDropdownChanged();
  } catch (error) {
    console.log(error);
    window.alert('An error occurred when retrieving the bookmark. Check the console log for more info.');
  }
}

async function onContainerDropdownChanged() {
  let height = 0;

  if (containerDropdown.value === 'none') {
    height = 350;

    warningSection.classList.add('hidden');
  } else {
    height = 450;

    warningSection.classList.remove('hidden');

    const url = `http://www.${containerDropdown.value}.${info.preferences['redirect-key'].value}`;
    warningLink.setAttribute('href', url);
    warningLink.textContent = url;
  }

  try {
    await browser.runtime.sendMessage({
      action: 'resize-window',
      windowId: info.bookmark.windowId,
      width: 375,
      height: height,
    });
  } catch (error) {
    console.log(error);
    window.alert('An error occurred when resizing the window. Check the console log for more info.');
  }
}

async function onCancelButtonClicked() {
  try {
    if (!info.bookmark.isEdit) {
      await browser.runtime.sendMessage({
        action: 'remove-bookmark',
        id: info.bookmark.id,
      });
    }

    window.close();
  } catch (error) {
    console.log(error);
    window.alert('An error occurred when removing the bookmark. Check the console log for more info.');
  }
}

async function onDoneButtonClicked() {
  try {
    if (info.bookmark.isFolder) {
      for (const child of info.bookmark.children) {
        await addBookmark(child, child.name, child.url, child.parentId, containerDropdown.value);
      }
    }
    await addBookmark(info.bookmark, nameField.value, urlField.value, folderDropdown.value, containerDropdown.value);

    window.close();
  } catch (error) {
    console.log(error);
    window.alert('An error occurred when adding the bookmark. Check the console log for more info.');
  }
}

async function addBookmark(bookmarkInfo, title, url, parentId, containerId) {
  const oldInfo =  {
    parentId: bookmarkInfo.parentId,
    title: bookmarkInfo.name,
  };
  const newInfo = {
    parentId,
    title,
  };

  if (!bookmarkInfo.isFolder) {
    oldInfo.url = bookmarkInfo.url;
    newInfo.url = containerId === 'none' ? url : `${url.replace(new RegExp(`#${info.preferences['redirect-key'].value}-(.*)`), '')}#${info.preferences['redirect-key'].value}-${containerId}`;
  }

  await browser.runtime.sendMessage({
    action: 'add-bookmark',
    id: bookmarkInfo.id,
    old: oldInfo,
    new: newInfo,
  });
}

/**
 * @param {HTMLSelectElement} dropdown
 * @param {OptionDetails[]} options
 * @param {Number} level
 */
function addOptions(dropdown, options, level = 0) {
  for (const option of options) {
    const optionElement = document.createElement('option');
    optionElement.value = option.id;
    optionElement.textContent = `${'-'.repeat(level)} ${option.name}`;

    dropdown.appendChild(optionElement);

    if (option.children && option.children.length > 0) {
      addOptions(dropdown, option.children, level + 2);
    }
  }
}

function clearOptions(dropdown) {
  const range = document.createRange();
  range.selectNodeContents(dropdown);
  range.deleteContents;
  range.detach();
}

function onMessageReceived(message) {
  switch (message.action) {
    case 'check-popup-existence-for-bookmark': {
      if (message.id == info.bookmark.id)
        return Promise.resolve(true);
      break;
    }
    case 'bookmark-changed': {
      if (message.id != info.bookmark.id)
        break;
      if ('name' in message)
        nameField.value = info.bookmark.name = message.name;
      if ('url' in message)
        urlField.value = info.bookmark.url = message.url;
      break;
    }
    case 'bookmark-moved': {
      if (message.id != info.bookmark.id)
        break;
      clearOptions(folderDropdown);
      addOptions(folderDropdown, info.folders = message.folders);
      folderDropdown.value = info.bookmark.parentId = message.parentId;
      break;
    }
  }
}