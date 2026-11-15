# Chinese Frequency Ranks Provenance Note

Local seeded file:

- `assets/resources/rank_freq.json`

Use in Remlang:

- Chinese search ranking support
- Chinese entry frequency ordering during seeding

Most likely source family:

- `BCC` / `BLCU Chinese Corpus`
- Beijing Language and Culture University corpus resources

Provenance trail currently tracked:

- A forum post you identified points to a downloadable BCC frequency resource:
  <https://www.chinese-forums.com/forums/topic/56677-word-frequency-list-based-on-a-15-billion-character-corpus-bcc-blcu-chinese-corpus/>
- That thread points to the official BCC resource path:
  `http://bcc.blcu.edu.cn/downloads/resources/BCC_LEX_Zh.zip`
- The official BCC site is currently served from:
  <https://bcc.blcu.edu.cn/>
- The linked BCC paper identifies BCC as the `BLCU Corpus Center` corpus and
  describes it as a Beijing Language and Culture University online corpus:
  - BLCU faculty citation page:
    <https://faculty.blcu.edu.cn/rgz/en/lwcg/190886/content/70234.htm>
  - Accessible mirror of the 2016 paper:
    <https://corpus.bfsu.edu.cn/__local/A/44/48/B802652D9139A5D90CA05EAB53D_7B8F7092_1862A5.pdf?e=.pdf>

What is verified:

- The repo's `rank_freq.json` is plausibly derived from the BCC/BLCU word
  frequency list family.
- The BCC/BLCU corpus is the relevant source family to attribute for provenance.
- The linked paper gives a proper academic source to cite for the corpus itself:
  荀恩东、饶高琦、肖晓悦、臧娇娇，《大数据背景下BCC语料库的研制》，《语料库语言学》
  2016年第3卷第1期。

What is not yet verified:

- A clear open-content license for the downloadable frequency list
- A direct official reuse statement equivalent to a Creative Commons, BSD, MIT,
  or similarly explicit redistribution license

Current repo policy:

- Because provenance looks plausible but the reuse terms are still unclear,
  `rank_freq.json` is not currently shown on the in-app About screen.
- If clearer official licensing or reuse language is found later, this file can
  be promoted into the About attributions.

References:

- <https://www.chinese-forums.com/forums/topic/56677-word-frequency-list-based-on-a-15-billion-character-corpus-bcc-blcu-chinese-corpus/>
- <https://bcc.blcu.edu.cn/>
- <https://faculty.blcu.edu.cn/rgz/en/lwcg/190886/content/70234.htm>
- <https://corpus.bfsu.edu.cn/__local/A/44/48/B802652D9139A5D90CA05EAB53D_7B8F7092_1862A5.pdf?e=.pdf>
