# Container Bookmarks

A Firefox extension that allows you to open bookmarks in containers.

<a href="https://addons.mozilla.org/en-US/firefox/addon/container-bookmarks/">
  <img src="https://raw.githubusercontent.com/rafael-gssa/esgst/master/firefox_badge.png" alt="Firefox">
</a>

### How does it work?

It is not currently possible to configure bookmarks to open in containers at a bookmark-level, so this extension uses the workaround that was posted by GodKratos [here](https://github.com/mozilla/multi-account-containers/issues/323#issuecomment-495058238), but makes that process much easier and faster.

### How to use it?

When you create a new bookmark, the extension will open a popup similar to the one below, where you can change the bookmark details just like you would through the native Firefox popup. But in addition to that, you can also choose which container you want the bookmark to open in.

![](https://imgur.com/igYkntl.png)

When you choose a container, the message below appears.

![](https://imgur.com/YmTVES0.png)

Next, you have to do what it says: open http://www.social.container/ in a social container, then open the Multi-Account Containers menu and enable the option "Always open in container", as illustrated below.

![](https://imgur.com/2jAS34A.png)

Now, every time you go to http://www.social.container/, it will open in a social container. The extension uses this functionality to perform the redirect:

1. When you save the bookmark, it will be saved with a fragment appended at the end of the URL to indicate that it is a container bookmark. For example: https://github.com/#container-social
2. When you open the bookmark, you will navigate to https://github.com/#container-social.
3. The extension will see that the URL has a `#container-%name%` fragment and will redirect you to `http://www.%name%.container/%original-url%`. For example: http://www.social.container/https://github.com/
4. Since http://www.social.container/ is configured to always open in a social container, this means that you will now be in the desired container.
5. Finally, the extension will redirect you to the original URL, so that you arrive at https://github.com/ in a social container.

The extension also adds a "Edit Container Bookmark" context menu to your bookmarks, as seen in the image below, so that you can edit them and move them to a different container if you wish.

![](https://i.imgur.com/19WB59N.png)

If you want to use another redirect key instead of "container", you can change it in the preferences page of the extension, as shown below.

![](https://imgur.com/PaKtC1O.png)

### Permissions

The extension uses the following permissions:

Permission | Reason
:-: | :-:
<all_urls> | Used along with `webRequest` and `webRequestBlocking`.
bookmarks | Used to detect when a new bookmark was created, to remove and update bookmarks, and to retrieve the names of your bookmark folders.
contextualIdentities | Used to retrieve the names of your containers.
menus | Used to create a context menu for bookmarks.
storage | Used to save your preferences.
webRequest | Used to monitor your requests to search for container fragments.
webRequestBlocking | Used to intercept and redirect requests with container fragments.
