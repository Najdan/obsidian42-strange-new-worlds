// This module builds on Obsidians cache to provide more specific link information

import { CachedMetadata, HeadingCache, stripHeading, TFile, Pos, parseLinktext } from 'obsidian';
import SNWPlugin from './main';
import { Link, TransformedCache } from './types';

let references: { [x: string]: Link[] };
let allLinkResolutions: Link[];
let lastUpdateToReferences = 0;
let thePlugin: SNWPlugin;

export function setPluginVariableForIndexer(plugin: SNWPlugin) {
  thePlugin = plugin;
}

export function getReferencesCache() {
  return references;
}

export function getSnwAllLinksResolutions() {
  return allLinkResolutions;
}

/**
 * Buildings a optimized list of cache references for resolving the block count.
 * It is only updated when there are data changes to the vault. This is hooked to an event
 * trigger in main.ts
 * @export
 */
export function buildLinksAndReferences(): void {
  if (thePlugin.showCountsActive != true) return;

  allLinkResolutions = [];
  thePlugin.app.metadataCache.iterateReferences((src, refs) => {
    const resolvedFilePath = parseLinktext(refs.link);
    if (resolvedFilePath.path === '') resolvedFilePath.path = src.replace('.md', '');
    if (resolvedFilePath?.path) {
      const resolvedTFile = thePlugin.app.metadataCache.getFirstLinkpathDest(resolvedFilePath.path, '/');
      const fileLink = resolvedTFile === null ? '' : resolvedTFile.path.replace('.md', '') + stripHeading(resolvedFilePath.subpath); // file doesnt exist, empty link
      const ghlink = resolvedTFile === null ? resolvedFilePath.path : ''; // file doesnt exist, its a ghost link
      const sourceFile = thePlugin.app.metadataCache.getFirstLinkpathDest(src, '/');

      if (thePlugin.settings.enableIgnoreObsExcludeFoldersLinksFrom)
        if (thePlugin.app.metadataCache.isUserIgnored(sourceFile?.path ?? '')) return;

      if (thePlugin.settings.enableIgnoreObsExcludeFoldersLinksTo) if (thePlugin.app.metadataCache.isUserIgnored(fileLink)) return;

      allLinkResolutions.push({
        reference: {
          displayText: refs.displayText ?? '',
          // link: refs.link, // old approach
          link: fileLink != '' ? fileLink : ghlink,
          position: refs.position
        },
        resolvedFile: resolvedTFile,
        ghostLink: ghlink,
        realLink: refs.link,
        sourceFile: sourceFile,
        excludedFile: false
      });
    }
  });

  // START: Remove file exclusions for frontmatter snw-index-exclude
  const snwIndexExceptionsList = Object.entries(app.metadataCache.metadataCache).filter((e) => {
    return e[1]?.frontmatter?.['snw-index-exclude'];
  });
  const snwIndexExceptions = Object.entries(app.metadataCache.fileCache).filter((e) => {
    return snwIndexExceptionsList.find((f) => f[0] === e[1].hash);
  });

  for (let i = 0; i < allLinkResolutions.length; i++) {
    allLinkResolutions[i].excludedFile = false;
    if (allLinkResolutions[i]?.resolvedFile?.path) {
      const fileName = allLinkResolutions[i].resolvedFile?.path ?? '';
      for (let e = 0; e < snwIndexExceptions.length; e++) {
        if (fileName == snwIndexExceptions[e][0]) {
          allLinkResolutions[i].excludedFile = true;
          break;
        }
      }
    }
  }
  // END: Exclusions

  const refs = allLinkResolutions.reduce((acc: { [x: string]: Link[] }, link: Link): { [x: string]: Link[] } => {
    let keyBasedOnLink = '';
    // let keyBasedOnFullPath = ""

    keyBasedOnLink = link.reference.link;
    // if(link?.resolvedFile)
    //     keyBasedOnFullPath = link.resolvedFile.path.replace(link.resolvedFile.name,"") + link.reference.link;
    // else
    //     keyBasedOnFullPath = link.ghostLink;

    // if(keyBasedOnLink===keyBasedOnFullPath) {
    //     keyBasedOnFullPath=null;
    // }

    if (!acc[keyBasedOnLink]) {
      acc[keyBasedOnLink] = [];
    }
    acc[keyBasedOnLink].push(link);

    // if(keyBasedOnFullPath!=null) {
    //     if(!acc[keyBasedOnFullPath]) {
    //         acc[keyBasedOnFullPath] = [];
    //     }
    //     acc[keyBasedOnFullPath].push(link)
    // }
    return acc;
  }, {});

  references = refs;
  // @ts-ignore
  window.snwAPI.references = references;
  lastUpdateToReferences = Date.now();
}

// following MAP works as a cache for the getCurrentPage call. Based on time elapsed since last update, it just returns a cached transformedCache object
const cacheCurrentPages = new Map<string, TransformedCache>();

/**
 * Provides an optimized view of the cache for determining the block count for references in a given page
 *
 * @export
 * @param {TFile} file
 * @return {*}  {TransformedCache}
 */
export function getSNWCacheByFile(file: TFile): TransformedCache {
  if (cacheCurrentPages.has(file.path)) {
    const cachedPage = cacheCurrentPages.get(file.path);
    if (cachedPage) {
      const cachedPageCreateDate = cachedPage.createDate ?? 0;
      // Check if references have been updated since last cache update, and if cache is old
      if (
        lastUpdateToReferences < cachedPageCreateDate &&
        cachedPageCreateDate + thePlugin.settings.cacheUpdateInMilliseconds > Date.now()
      ) {
        return cachedPage;
      }
    }
  }

  if (thePlugin.showCountsActive != true) return {};

  const transformedCache: TransformedCache = {};
  const cachedMetaData = thePlugin.app.metadataCache.getFileCache(file);
  if (!cachedMetaData) {
    return transformedCache;
  }

  if (!references) {
    buildLinksAndReferences();
  }

  const headings: string[] = Object.values(thePlugin.app.metadataCache.metadataCache).reduce((acc: string[], file: CachedMetadata) => {
    const headings = file.headings;
    if (headings) {
      headings.forEach((heading: HeadingCache) => {
        acc.push(heading.heading);
      });
    }
    return acc;
  }, []);

  if (cachedMetaData?.blocks) {
    const filePath = file.path.replace('.md', '');
    transformedCache.blocks = Object.values(cachedMetaData.blocks).map((block) => ({
      key: filePath + block.id,
      pos: block.position,
      page: file.basename,
      type: 'block',
      references: references[filePath + block.id] || []
    }));
  }

  if (cachedMetaData?.headings) {
    transformedCache.headings = cachedMetaData.headings.map((header: { heading: string; position: Pos; level: number }) => ({
      original: '#'.repeat(header.level) + ' ' + header.heading,
      key: `${file.path.replace('.md', '')}${stripHeading(header.heading)}`,
      headerMatch: header.heading,
      headerMatch2: file.basename + '#' + header.heading,
      pos: header.position,
      page: file.basename,
      type: 'heading',
      references: references[`${file.path.replace('.md', '')}${stripHeading(header.heading)}`] || []
    }));
  }

  if (cachedMetaData?.links) {
    transformedCache.links = cachedMetaData.links.map((link) => {
      let newLinkPath = parseLinkTextToFullPath(link.link);

      if (newLinkPath === '') {
        // file does not exist, likely a ghost file, so just leave the link
        newLinkPath = link.link;
      }

      if (newLinkPath.startsWith('#^') || newLinkPath.startsWith('#')) {
        // handles links from same page
        newLinkPath = file.path.replace('.md', '') + stripHeading(newLinkPath);
      }

      return {
        key: newLinkPath,
        original: link.original,
        type: 'link',
        pos: link.position,
        page: file.basename,
        references: references[newLinkPath] || []
      };
    });
    if (transformedCache.links) {
      transformedCache.links = transformedCache.links.map((link) => {
        if (link.key.includes('#') && !link.key.includes('#^')) {
          const heading = headings.filter((heading: string) => stripHeading(heading) === link.key.split('#')[1])[0];
          link.original = heading ? heading : undefined;
        }
        return link;
      });
    }
  }

  if (cachedMetaData?.embeds) {
    transformedCache.embeds = cachedMetaData.embeds.map((embed) => {
      let newEmbedPath = parseLinkTextToFullPath(embed.link);

      // if newEmbedPath is empty, then this is a link on the same page
      if (newEmbedPath === '' && (embed.link.startsWith('#^') || embed.link.startsWith('#'))) {
        newEmbedPath = file.path.replace('.md', '') + stripHeading(embed.link);
      }

      const output = {
        key: newEmbedPath,
        page: file.basename,
        type: 'embed',
        pos: embed.position,
        references: references[newEmbedPath] || []
      };
      return output;
    });
    if (transformedCache.embeds) {
      transformedCache.embeds = transformedCache.embeds.map((embed) => {
        if (embed.key.includes('#') && !embed.key.includes('#^') && transformedCache.headings) {
          const heading = headings.filter((heading: string) => heading.includes(embed.key.split('#')[1]))[0];
          embed.original = heading ? heading : undefined;
        }

        if (embed.key.startsWith('#^') || embed.key.startsWith('#')) {
          embed.key = `${file.basename}${embed.key}`;
          embed.references = references[embed.key] || [];
        }
        return embed;
      });
    }
  }

  transformedCache.cacheMetaData = cachedMetaData;
  transformedCache.createDate = Date.now();
  cacheCurrentPages.set(file.path, transformedCache);

  return transformedCache;
}

export function parseLinkTextToFullPath(link: string): string {
  const resolvedFilePath = parseLinktext(link);
  const resolvedTFile = thePlugin.app.metadataCache.getFirstLinkpathDest(resolvedFilePath.path, '/');
  if (resolvedTFile === null) return '';
  else return resolvedTFile.path.replace('.md', '') + stripHeading(resolvedFilePath.subpath);
}
