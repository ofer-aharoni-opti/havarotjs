import { Cluster } from "../cluster";
import { Syllable } from "../syllable";
import { SylOpts } from "../text";
import { vowels } from "./regularExpressions";

type Syl = Cluster[];
type Mixed = (Syllable | Cluster)[];

/**
 * Creates a new syllable from the `syl`, pushes it to `results` and returns an empty array
 */
const createNewSyllable = (result: Mixed, syl: Syl, isClosed?: boolean): Syl => {
  isClosed = isClosed || false;
  const syllable = new Syllable(syl, { isClosed });
  result.push(syllable);
  return [];
};

/**
 * Group clusters for the final syllable
 *
 * @remarks
 *
 * Grouping the final first helps to avoid issues with final kafs/tavs
 */
const groupFinal = (arr: Cluster[]): Mixed => {
  const len = arr.length;
  let i = 0;
  /** temporary array to collect clusters for the current syllable */
  const syl: Syl = [];
  /** collects the end result */
  let result: Mixed = [];
  let vowelPresent = false;

  // get final cluster and push to syl
  let finalCluster = arr[i];
  syl.unshift(finalCluster);

  // if the final cluster is punctuation and there is a next cluster
  // then push the next cluster to syl.
  if (finalCluster.isPunctuation && arr[i + 1]) {
    i++;
    finalCluster = arr[i];
    syl.unshift(finalCluster);
  }

  if (finalCluster.hasVowel) {
    // check if finalCluster is syllable
    vowelPresent = true;
    i++;
  } else if (finalCluster.isShureq) {
    // check if final cluster isShureq and get preceding Cluster
    i++;
    if (i <= len && arr[i]) {
      syl.unshift(arr[i]);
    }
    vowelPresent = true;
    i++;
  } else {
    i++;
  }

  while (!vowelPresent) {
    const nxt = arr[i];
    const curr = nxt ? nxt : false;
    if (!curr) {
      break;
    }
    syl.unshift(curr);
    if (curr.isShureq) {
      i++;
      if (arr[i]) syl.unshift(arr[i]);
      vowelPresent = true;
    } else {
      const clusterHasVowel = "hasVowel" in curr ? curr.hasVowel : true;
      vowelPresent = clusterHasVowel || curr.isShureq;
    }
    i++;
    if (i > len) {
      break;
    }
  }

  const finalChar = finalCluster.chars.filter((c) => c.sequencePosition !== 4).at(-1)?.text || "";
  const hasFinalVowel = vowels.test(finalChar);
  const isClosed =
    !finalCluster.isShureq &&
    !finalCluster.isMater &&
    // if final cluster is an aleph, then the syllable is open (e.g. בָּרָ֣א)
    // unless the preceding cluster has a sheva (e.g. וַיַּ֧רְא)
    (!/\u{05D0}/u.test(finalCluster.text) || finalCluster?.prev?.value?.hasSheva) &&
    // if the final cluster is an he but without a mappiq, then the syllable is open
    // this applies even to cases where the he is not a mater (e.g. פֹּ֖ה)
    !/\u{05D4}(?!\u{05bc})/u.test(finalCluster.text) &&
    !hasFinalVowel;
  const finalSyllable = new Syllable(syl, { isClosed });
  const remainder = arr.slice(i);
  result = remainder.length ? remainder : [];
  result.unshift(finalSyllable);

  return result;
};

/**
 * @remarks groups shevas either by themselves or with preceding short vowel
 */
const groupShevas = (arr: Mixed, options: SylOpts): Mixed => {
  const len = arr.length;
  /** temporary array to collect clusters for the current syllable */
  let syl: Syl = [];
  /** collects the end result */
  const result: Mixed = [];
  /** flag indicating if a sheva is present in the `syl` */
  let shevaPresent = false;
  /** creates a new syllable from the `syl`, pushes it to `results` and returns an empty array */
  const shevaNewSyllable = createNewSyllable.bind(groupShevas, result);

  for (let index = 0; index < len; index++) {
    const cluster = arr[index];

    // skip if already a syllable
    if (cluster instanceof Syllable) {
      result.push(cluster);
      continue;
    }

    const clusterHasSheva = cluster.hasSheva;

    // if a sheva is already present and the current cluster has a sheva
    // then there are two shevas in a row, meaning the first cluster is it's own syllable
    if (shevaPresent && clusterHasSheva) {
      syl = shevaNewSyllable(syl);
      syl.unshift(cluster);
      continue;
    }

    // in here, add a check for in the prev cluster (i.e. syl) or use shevaPresent
    if (clusterHasSheva && cluster.hasMeteg && options.shevaWithMeteg) {
      syl.unshift(cluster);
      syl = shevaNewSyllable(syl);
      continue;
    }
    const consonant = cluster.chars[0].text;
    const prevConsonant = arr[index - 1]?.chars[0].text || "";
    const nextClusterVowel = arr[index + 1];
    // We also need to check if this cluster and the previous cluster are different consonants
    // because if they are the same consonant (and the previous vowel is not short), then the sheva will be vocal.
    // e.g. "סָבְב֥וּ" is [ 'סָ', 'בְ', 'ב֥וּ' ], but "הִנְנִי֩" is [ 'הִנְ', 'נִי֩' ] b/c of the short vowel.
    // Also remember that prev and next are switched because we are iterating backwards.
    if (
      !shevaPresent &&
      clusterHasSheva &&
      (consonant !== prevConsonant || (nextClusterVowel instanceof Cluster && nextClusterVowel.hasShortVowel))
    ) {
      shevaPresent = true;
      syl.unshift(cluster);
      continue;
    }

    // the occurrence of a half-vowel is a non-standard spelling
    // but it does occur in some texts
    if (shevaPresent && (cluster.hasShortVowel || cluster.hasHalfVowel)) {
      if (options.shevaAfterMeteg && cluster.hasMeteg) {
        syl = shevaNewSyllable(syl);
        syl.unshift(cluster);
        continue;
      }
      const dageshRegx = /\u{05BC}/u;
      const prev = syl[0].text;
      const sqnmlvy = /[שסצקנמלוי]/;
      const wawConsecutive = /וַ/;
      // check if there is a doubling dagesh
      if (dageshRegx.test(prev)) {
        syl = shevaNewSyllable(syl);
      }
      // check for waw-consecutive w/ sqnmlvy letter
      else if (
        (options.sqnmlvy || (options.shevaAfterMeteg && cluster.hasMeteg)) &&
        sqnmlvy.test(prev) &&
        wawConsecutive.test(cluster.text)
      ) {
        syl = shevaNewSyllable(syl);
        result.push(new Syllable([cluster]));
        shevaPresent = false;
        continue;
      }
      // check for article preceding yod w/ sheva
      else if (options.article && /[ילמ]/.test(prev) && /הַ/.test(cluster.text)) {
        syl = shevaNewSyllable(syl);
        result.push(new Syllable([cluster]));
        shevaPresent = false;
        continue;
      }
      syl.unshift(cluster);
      syl = shevaNewSyllable(syl, true);
      shevaPresent = false;
      continue;
    }

    if (shevaPresent && cluster.hasLongVowel) {
      if (options.longVowels || (cluster.hasMeteg && options.shevaAfterMeteg)) {
        syl = shevaNewSyllable(syl);
        result.push(cluster);
        shevaPresent = false;
      } else {
        syl.unshift(cluster);
        syl = shevaNewSyllable(syl, true);
        shevaPresent = false;
      }
      continue;
    }

    if (shevaPresent && cluster.isShureq) {
      if (!options.wawShureq && (!options.shevaAfterMeteg || !cluster.hasMeteg) && len - 1 === index) {
        syl.unshift(cluster);
        syl = shevaNewSyllable(syl, true);
      } else {
        syl = shevaNewSyllable(syl);
        result.push(cluster);
        shevaPresent = false;
      }
      continue;
    }

    if (shevaPresent && cluster.isMater && options.longVowels) {
      syl = shevaNewSyllable(syl);
      result.push(cluster);
      shevaPresent = false;
      continue;
    }

    if (shevaPresent && !cluster.hasVowel) {
      syl.unshift(cluster);
      continue;
    }

    result.push(cluster);
  }

  if (syl.length) {
    shevaNewSyllable(syl);
  }

  return result;
};

/**
 * @remarks groups non-final maters with preceding cluster
 */
const groupMaters = (arr: Mixed, strict: boolean = true): Mixed => {
  const len = arr.length;
  /** temporary array to collect clusters for the current syllable */
  let syl: Syl = [];
  /** collects the end result */
  const result: Mixed = [];
  /** creates a new syllable from the `syl`, pushes it to `results` and returns an empty array */
  const materNewSyllable = createNewSyllable.bind(groupMaters, result);

  for (let index = 0; index < len; index++) {
    const cluster = arr[index];

    if (cluster instanceof Syllable) {
      result.push(cluster);
      continue;
    }

    if (cluster.isMater) {
      syl.unshift(cluster);
      const nxt = arr[index + 1];

      if (!nxt && strict) {
        const word = arr.map((i) => i.text).join("");
        throw new Error(`The cluster ${cluster.text} is a mater, but nothing precedes it in ${word}`);
      }

      if (nxt instanceof Syllable) {
        const word = arr.map((i) => i.text).join("");
        if (strict) {
          throw new Error(`Syllable ${nxt.text} should not precede a Cluster with a Mater in ${word}`);
        } else {
          syl.unshift(...nxt.clusters);
        }
      } else {
        syl.unshift(nxt);
      }

      syl = materNewSyllable(syl);
      index++;
    }
    // check for quiesced alef — not a mater, but similar
    else if (!cluster.hasVowel && /א/.test(cluster.text)) {
      syl.unshift(cluster);
      const nxt = arr[index + 1];

      if (!nxt && strict) {
        const word = arr.map((i) => i.text).join("");
        throw new Error(`The cluster ${cluster.text} is a quiesced alef, but nothing precedes it in ${word}`);
      }

      // at this point, only final syllables and shevas are Syllables
      if (nxt instanceof Syllable) {
        result.push(cluster);
        continue;
      }

      if (nxt) syl.unshift(nxt);

      syl = materNewSyllable(syl);
      index++;
    } else {
      result.push(cluster);
    }
  }

  return result;
};

/**
 * @remarks groups non-final shureqs with preceding cluster
 */
const groupShureqs = (arr: Mixed, strict: boolean = true): Mixed => {
  const len = arr.length;
  /** temporary array to collect clusters for the current syllable */
  let syl: Syl = [];
  /** collects the end result */
  const result: Mixed = [];
  /** creates a new syllable from the `syl`, pushes it to `results` and returns an empty array */
  const shureqNewSyllable = createNewSyllable.bind(groupShureqs, result);

  for (let index = 0; index < len; index++) {
    const cluster = arr[index];

    if (cluster instanceof Syllable) {
      result.push(cluster);
      continue;
    }

    if (cluster.isShureq) {
      syl.unshift(cluster);
      const nxt = arr[index + 1];

      if (strict && nxt instanceof Syllable) {
        const word = arr.map((i) => i.text).join("");
        throw new Error(`Syllable ${nxt.text} should not precede a Cluster with a Shureq in ${word}`);
      }

      /**
       * cast as Cluster to a
       */
      if (nxt) syl.unshift(nxt as Cluster);

      syl = shureqNewSyllable(syl);
      index++;
    } else {
      result.push(cluster);
    }
  }
  return result;
};

/**
 * @remarks a preprocessing step that groups clusters into intermediate syllables by vowels or shevas
 */
const groupClusters = (arr: Cluster[], options: SylOpts): Mixed => {
  const rev = arr.reverse();
  const finalGrouped = groupFinal(rev);
  const shevasGrouped = groupShevas(finalGrouped, options);
  const shureqGroups = groupShureqs(shevasGrouped, options.strict);
  const matersGroups = groupMaters(shureqGroups, options.strict);
  const result = matersGroups.reverse();
  return result;
};

const setIsClosed = (syllable: Syllable, index: number, arr: Syllable[]) => {
  // no need to check, groupFinal takes care of it
  if (index === arr.length - 1) {
    return;
  }
  if (!syllable.isClosed) {
    const dageshRegx = /\u{05BC}/u;
    const hasShortVowel = !!syllable.clusters.filter((cluster) => cluster.hasShortVowel).length;
    /**
     * if `hasShortVowel` is true, nothing to check;
     * if a syllable has only one cluster with a sheva, then it is false;
     * else, it means the preceding cluster has no vowel
     */
    const hasNoVowel = hasShortVowel || !!(syllable.clusters.filter((cluster) => !cluster.hasVowel).length - 1);
    const prev = arr[index + 1];
    const prevDagesh = dageshRegx.test(prev.clusters[0].text);
    syllable.isClosed = (hasShortVowel || hasNoVowel) && prevDagesh;
  }
};

const setIsAccented = (syllable: Syllable) => {
  if (syllable.isAccented) {
    return;
  }
  // TODO: this is pretty hacky, but it works; find a more elegant solution
  const jerusalemFinal = /\u{5B4}\u{05DD}/u;
  const jerusalemPrev = /ל[\u{5B8}\u{5B7}]/u;
  let prev = syllable.prev?.value;
  if (jerusalemFinal.test(syllable.text) && prev && jerusalemPrev.test(prev.text)) {
    prev.isAccented = true;
    return;
  }

  /**
   * Note: Miqra Al Pi HaMesorah (MAPM) has "accent helpers".
   * Often if the taam is not placed on the accented syllable,
   * then a taam is added on the previous/next, accented syllable.
   *
   * E.g.: עַל־יֹאשִׁיָּ֒הוּ֒
   *
   * Because it is not entirely possible to ascertain stress from just the taamim,
   * it is best to MAPM because of the aforementioned "accent helpers".
   */

  const segolta = /\u{0592}/u;
  if (segolta.test(syllable.text)) {
    // see לָֽאָדָם֒ as an example of segolta on the final syllable
    if (!syllable.next && prev) {
      // see יֹאשִׁיָּ֒הוּ֒ as an example of segolta on a previous syllable
      while (prev) {
        if (segolta.test(prev.text)) {
          prev.isAccented = true;
          return;
        }
        prev = (prev?.prev?.value as Syllable) ?? null;
      }
    }

    // if the segolta is not final, then it is the accented syllable
    // though, it was likely already accented in the while loop above
    syllable.isAccented = true;
    return;
  }

  // note that a zarqa is incorrectly encoded as "zinor" in the Unicode spec
  const zarqa = /\u{05AE}/u;
  // a zarqa's "helper" in MAPM
  // see more https://forums.accordancebible.com/topic/31576-zinor-and-zarqa-accents/#comment-156318
  if (zarqa.test(syllable.text)) {
    const zarqaHelper = /\u{0598}/u;
    // see לָֽאָדָם֒ as an example of zarqa on the final syllable
    // a zarqa should always be on the final syllable
    if (!syllable.next && prev) {
      // see וַיֹּ֘אמֶר֮ as an example of zarqa helper on a previous syllable
      while (prev) {
        if (zarqaHelper.test(prev.text)) {
          prev.isAccented = true;
          return;
        }
        prev = (prev?.prev?.value as Syllable) ?? null;
      }
    }
  }

  // prepositive
  // the sinnorit is incorrectly named in the Unicode spec as ZARQA (U+0598)
  // the same character is also used as the zarqaHelper above
  const sinnorit = /\u{0598}/u;
  if (sinnorit.test(syllable.text)) {
    syllable.isAccented = false;
    return;
  }

  // postpositive
  // check if any preceding syllable has a pashta or qadma character
  const pashta = /\u{0599}/u;
  const sylText = syllable.text;
  if (!syllable.next && pashta.test(sylText)) {
    const qadma = /\u{05A8}/u;
    while (prev) {
      if (pashta.test(prev.text) || qadma.test(prev.text)) {
        return;
      }
      prev = (prev?.prev?.value as Syllable) ?? null;
    }
  }

  // postpositive
  const telishaQetana = /\u{05A9}/u;
  if (telishaQetana.test(syllable.text)) {
    while (prev) {
      if (telishaQetana.test(prev.text)) {
        prev.isAccented = true;
        return;
      }
      prev = (prev?.prev?.value as Syllable) ?? null;
    }

    syllable.isAccented = true;
    return;
  }

  // prepositive
  const teslishaGedola = /\u{05A0}/u;
  if (teslishaGedola.test(syllable.text)) {
    let next = syllable.next?.value;

    while (next) {
      if (teslishaGedola.test(next.text)) {
        next.isAccented = true;
        return;
      }
      next = (next?.next?.value as Syllable) ?? null;
    }

    syllable.isAccented = true;
    return;
  }

  // ole-weyored, the ole does not take the accent, only the "yored" (i.e. a merkha)
  // unless the ole is by itself
  const ole = /\u{05AB}/u;
  if (ole.test(syllable.text)) {
    const yored = /\u{05A5}/u;
    let next = syllable.next?.value;

    while (next) {
      if (yored.test(next.text)) {
        next.isAccented = true;
        syllable.isAccented = false;
        return;
      }
      next = (next?.next?.value as Syllable) ?? null;
    }

    syllable.isAccented = true;
    return;
  }

  // dechi, the dechi does not take the accent
  // so always assume the final syallble is accented
  const dechi = /\u{05AD}/u;
  if (dechi.test(syllable.text)) {
    let next = syllable.next?.value;

    while (next) {
      // if the last syllable, set as accented
      if (!next?.next) {
        next.isAccented = true;
        return;
      }
      next = (next?.next?.value as Syllable) ?? null;
    }
  }

  // the geresh muqdam always appears before a rebia, which receives the stress
  const gereshMuqdam = /\u{059D}/u;
  if (gereshMuqdam.test(syllable.text)) {
    syllable.isAccented = false;
    return;
  }

  const isAccented = syllable.clusters.filter((cluster) => (cluster.hasTaamim || cluster.hasSilluq ? true : false))
    .length
    ? true
    : false;
  syllable.isAccented = isAccented;
};

/**
 *
 * @remarks a step to get a Cluster's original position before filtering out latin
 */
const clusterPos = (cluster: Cluster, i: number): { cluster: Cluster; pos: number } => {
  return { cluster, pos: i };
};

const reinsertLatin = (syls: Syllable[], latin: { cluster: Cluster; pos: number }[]): Syllable[] => {
  const numOfSyls = syls.length;
  for (let index = 0; index < latin.length; index++) {
    const group = latin[index];
    const partial: Cluster[] = [];
    // if a latin cluster was at the beginning
    if (group.pos === 0) {
      partial.push(group.cluster);
      while (index + 1 < latin.length && latin[index + 1].pos === group.pos + 1) {
        partial.push(latin[index + 1].cluster);
        index++;
      }
      const firstSyl = syls[0];
      syls[0] = new Syllable([...partial, ...firstSyl.clusters], {
        isAccented: firstSyl.isAccented,
        isClosed: firstSyl.isClosed
      });
    } else {
      const lastSyl = syls[numOfSyls - 1];
      while (index < latin.length) {
        partial.push(latin[index].cluster);
        index++;
      }
      syls[numOfSyls - 1] = new Syllable([...lastSyl.clusters, ...partial], {
        isAccented: lastSyl.isAccented,
        isClosed: lastSyl.isClosed
      });
    }
  }
  return syls;
};

// Taamim whose graphical position does NOT mark the stressed syllable
// (prepositive + postpositive). Everything else in the taamim range is
// impositive and sits on the accented syllable.
const NON_STRESS_TAAMIM =
  /[\u{0592}\u{0598}\u{0599}\u{059D}\u{05A0}\u{05A9}\u{05AB}\u{05AD}\u{05AE}]/u;
const ANY_TAAM = /[\u{0591}-\u{05AE}]/u;

/** True if the word carries a taam that actually sits on the stressed syllable. */
const hasImpositiveTaam = (syllables: Syllable[]): boolean => {
  const text = syllables.map((s) => s.text).join("").replace(new RegExp(NON_STRESS_TAAMIM, "gu"), "");
  return ANY_TAAM.test(text);
};

// Segholate detection: disyllabic nouns (qatl/qitl/qutl, incl. guttural variants)
// are stressed on the penult (e.g. כֶּלֶב, מֶלֶךְ, סֵפֶר, בֹּקֶר, נַעַר).
const SEGOL = "\u{05B6}";
const PATACH = "\u{05B7}";
const GUTTURAL = /[\u{05D0}\u{05D7}\u{05E2}\u{05D4}]/u;
// A furtive patach: a final guttural (ח/ע/ה־mappiq) carrying a patach written
// AFTER it (e.g. חַ in נִיחֹחַ, רוּחַ). It is a post-tonic glide, never stressed.
const FURTIVE_PATACH = /(?:\u{05D7}|\u{05E2}|\u{05D4}\u{05BC})\u{05B7}(?:\u{05C3})?$/u;
// Short stem vowels of a segolate: chataf-segol/patach/qamats, tsere, segol,
// patach, holam.
const SEGOLATE_FIRST_VOWEL = /[\u{05B1}\u{05B2}\u{05B3}\u{05B5}\u{05B6}\u{05B7}\u{05B9}]/u;
// Same, plus qamats — allowed ONLY when the last stem vowel is a segol, i.e. the
// article-before-guttural compensatory lengthening (e.g. הָאָרֶץ). A qamats penult
// with a guttural-patach ending is a regular verb (שָׁלַח, לָקַח), NOT a segolate.
const SEGOLATE_FIRST_VOWEL_OR_QAMATS = /[\u{05B1}\u{05B2}\u{05B3}\u{05B5}\u{05B6}\u{05B7}\u{05B8}\u{05B9}]/u;

// The segolate stem is the LAST two syllables; a prefix (article/waw/preposition,
// e.g. הָאָרֶץ, הַמֶּלֶךְ, וַיֹּאמֶר) just adds syllables in front and does not
// move the penultimate stress off the stem.
const isSegholate = (syllables: Syllable[]): boolean => {
  if (syllables.length < 2) return false;
  const last = syllables[syllables.length - 1];
  const penult = syllables[syllables.length - 2];
  if (!last.isClosed) return false; // excludes ־ֶה matres like שָׂדֶה (milra)
  const lastVowel = last.vowels[last.vowels.length - 1];
  const penultVowel = penult.vowels[penult.vowels.length - 1];
  if (!penultVowel) return false;
  if (lastVowel === SEGOL) {
    return SEGOLATE_FIRST_VOWEL_OR_QAMATS.test(penultVowel);
  }
  if (lastVowel === PATACH && GUTTURAL.test(last.text)) {
    return SEGOLATE_FIRST_VOWEL.test(penultVowel); // short vowel only → excludes שָׁלַח
  }
  return false;
};

// Pronominal suffixes on plural nouns that force stress onto the penult (mil'el).
// Extend this list as needed; NOTE ־ֵיכֶם / ־ֵיהֶם stay milra, so are excluded.
const MILEL_SUFFIXES = [
  /\u{05B6}\u{05D9}\u{05DA}\u{05B8}$/u, // ־ֶיךָ  2ms  (e.g. עֲבָדֶיךָ)
  /\u{05B6}\u{05D9}\u{05D4}\u{05B8}$/u, // ־ֶיהָ  3fs
  /\u{05B7}\u{05D9}\u{05B4}\u{05D9}\u{05DA}\u{05B0}?$/u, // ־ַיִךְ 2fs
  /\u{05B5}\u{05D9}\u{05E0}\u{05D5}\u{05BC}$/u, // ־ֵינוּ 1cp
  /\u{05B8}\u{05D9}\u{05D5}$/u, // ־ָיו  3ms
  /\u{05B7}\u{05D9}\u{05B4}\u{05DD}$/u // ־ַיִם dual (e.g. שָׁמַיִם, יָדַיִם)
];

// Known exceptions: forms that match a mil'el heuristic above but are in fact
// milra. Matched against the full pointed word. Prefixed forms need their own
// entry (a prefix can change the vowels). Extend as needed.
const MILRA_EXCEPTIONS = new Set([
  "\u{05D0}\u{05B1}\u{05DE}\u{05B6}\u{05EA}" // אֱמֶת
]);

export const syllabify = (clusters: Cluster[], options: SylOpts, isWordInConstruct: boolean): Syllable[] => {
  const removeLatin = clusters.filter((cluster) => !cluster.isNotHebrew);
  const latinClusters = clusters.map(clusterPos).filter((c) => c.cluster.isNotHebrew);
  const groupedClusters = groupClusters(removeLatin, options);
  const syllables = groupedClusters.map((group) => (group instanceof Syllable ? group : new Syllable([group])));

  // set these before setting isClosed and isAccented siblings can be accsessed
  const [first, ...rest] = syllables;
  first.siblings = rest;

  // set syllable properties
  syllables.forEach(setIsClosed);
  syllables.forEach(setIsAccented);

  // if there is no accented syllable, then the last syllable is accented
  // unless that syllable is part of a word in construct
  if (!syllables.map((s) => s.isAccented).includes(true) && !isWordInConstruct) {
    syllables[syllables.length - 1].isAccented = true;
  }

  // Morphological fallback for stress.
  // The taamim above can only place stress when a taam actually sits on the
  // stressed consonant. With no taam at all, or with only a prepositive/
  // postpositive taam (e.g. dehi U+05AD), stress defaults to the last syllable,
  // which is wrong for many suffixed forms (e.g. עֲבָדֶיךָ, stressed on דֶי).
  // When no impositive (stress-bearing) taam is present, use the pronominal
  // suffix to move the stress to the penult where the suffix requires it.
  if (syllables.length > 1 && !hasImpositiveTaam(syllables)) {
    const wordText = syllables.map((s) => s.text).join("");
    if (
      !MILRA_EXCEPTIONS.has(wordText) &&
      (MILEL_SUFFIXES.some((re) => re.test(wordText)) || isSegholate(syllables))
    ) {
      syllables.forEach((s) => (s.isAccented = false));
      syllables[syllables.length - 2].isAccented = true;
    }
  }

  // A word has a single primary stress. If the taamim produced more than one
  // accented syllable (a pretonic ga'ya / meteg or a conjunctive helper sitting
  // alongside the main accent, e.g. וֶ֥אֱֽמוּנָתוֹ֮), keep only the primary one.
  // A ga'ya always precedes the tone syllable, so the primary accent is the
  // last (rightmost in reading order) marked syllable.
  const accentedIdx = syllables.reduce(
    (acc, syl, i) => (syl.isAccented ? [...acc, i] : acc),
    [] as number[]
  );
  if (accentedIdx.length > 1) {
    accentedIdx.slice(0, -1).forEach((i) => (syllables[i].isAccented = false));
  }

  // A furtive patach is a post-tonic glide (e.g. נִיחֹחַ, רוּחַ, מָשִׁיחַ) and is
  // never stressed. If the final syllable is a furtive patach and got accented,
  // move the stress to the preceding (tone) syllable.
  if (syllables.length > 1) {
    const ult = syllables[syllables.length - 1];
    const penult = syllables[syllables.length - 2];
    if (ult.isAccented && !ult.isClosed && !penult.isClosed && FURTIVE_PATACH.test(ult.text)) {
      ult.isAccented = false;
      penult.isAccented = true;
    }
  }

  // for each cluster, set its syllable
  syllables.forEach((s) => s.clusters.forEach((c) => (c.parent = s)));
  return latinClusters.length ? reinsertLatin(syllables, latinClusters) : syllables;
};
