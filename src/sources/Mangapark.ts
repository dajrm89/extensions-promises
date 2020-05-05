import { Source } from './Source'
import { Manga } from '../models/Manga/Manga'
import { Chapter } from '../models/Chapter/Chapter'
import { MangaTile } from '../models/MangaTile/MangaTile'
import { SearchRequest } from '../models/SearchRequest/SearchRequest'
import { Request } from '../models/RequestObject/RequestObject'
import { ChapterDetails } from '../models/ChapterDetails/ChapterDetails'
import { TagSection } from '../models/TagSection/TagSection'
import { HomeSectionRequest, HomeSection } from '../models/HomeSection/HomeSection'

const MP_DOMAIN = 'https://mangapark.net'

export class MangaPark extends Source {
  constructor(cheerio: CheerioAPI) {
    super(cheerio)
  }

  getMangaDetailsRequest(ids: string[]): Request[] {
    let requests: Request[] = []
    for (let id of ids) {
      let metadata = { 'id': id }
      requests.push(createRequestObject({
        url: `${MP_DOMAIN}/manga/`,
        headers: { Cookie: 'set=h=1' },
        metadata: metadata,
        method: 'GET',
        param: id
      }))
    }
    return requests
  }

  getMangaDetails(data: any[], metadata: any[]): Manga[] {
    let manga: Manga[] = []
    for (let [i, response] of data.entries()) {
      let $ = this.cheerio.load(response)

      let tagSections: TagSection[] = [createTagSection({ id: '0', label: 'genres', tags: [] }),
      createTagSection({ id: '1', label: 'demographic', tags: [] }),
      createTagSection({ id: '2', label: 'format', tags: [] })]

      // let id: string = (($('head').html() ?? "").match((/(_manga_name\s*=\s)'([\S]+)'/)) ?? [])[2]
      let image: string = $('img', '.manga').attr('src') ?? ""
      let rating: string = $('i', '#rating').text()
      let tableBody = $('tbody', '.manga')
      let titles: string[] = []
      let title = $('.manga').find('a').first().text()
      titles.push(title.substring(0, title.lastIndexOf(' ')))

      let hentai = false
      let author = ""
      let artist = ""
      let views = 0
      let status = 0
      for (let row of $('tr', tableBody).toArray()) {
        let elem = $('th', row).html()
        switch (elem) {
          case 'Author(s)': author = $('a', row).text(); break
          case 'Artist(s)': artist = $('a', row).first().text(); break
          case 'Popularity': {
            let pop = (/has (\d*(\.?\d*\w)?)/g.exec($('td', row).text()) ?? [])[1]
            if (pop.includes('k')) {
              pop = pop.replace('k', '')
              views = Number(pop) * 1000
            }
            else {
              views = Number(pop) ?? 0
            }
            break
          }
          case 'Alternative': {
            let alts = $('td', row).text().split('  ')
            for (let alt of alts) {
              let trim = alt.trim().replace(/(;*\t*)/g, '')
              if (trim != '')
                titles.push(trim)
            }
            break
          }
          case 'Genre(s)': {
            for (let genre of $('a', row).toArray()) {
              let item = $(genre).html() ?? ""
              let tag = item.replace(/<[a-zA-Z\/][^>]*>/g, "")
              if (item.includes('<b>')) {
                tagSections[1].tags.push(createTag({ id: tag, label: tag }))
              }
              else if (item.includes('Hentai')) {
                hentai = true
                tagSections[0].tags.push(createTag({ id: tag, label: tag }))
              }
              else {
                tagSections[0].tags.push(createTag({ id: tag, label: tag }))
              }
            }
            break
          }
          case 'Status': {
            let stat = $('td', row).text()
            if (stat.includes('Ongoing'))
              status = 1
            else if (stat.includes('Completed')) {
              status = 0
            }
            break
          }
          case 'Type': {
            let type = $('td', row).text().split('-')[0].trim()
            tagSections[2].tags.push(createTag({ id: type.trim(), label: type.trim() }))
          }
        }
      }

      let summary = $('.summary').html() ?? ""
      manga.push({
        id: metadata[i].id,
        titles: titles,
        image: image,
        rating: Number(rating),
        status: status,
        artist: artist,
        author: author,
        tags: tagSections,
        views: views,
        description: summary,
        hentai: hentai
      })
    }

    return manga
  }


  getChaptersRequest(mangaId: string): Request {
    let metadata = { 'id': mangaId }
    return createRequestObject({
      url: `${MP_DOMAIN}/manga/`,
      method: "GET",
      metadata: metadata,
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      param: mangaId
    })
  }

  getChapters(data: any, metadata: any): Chapter[] {
    let $ = this.cheerio.load(data)
    let chapters: Chapter[] = []
    for (let elem of $('#list').children('div').toArray()) {
      // streamNum helps me navigate the weird id/class naming scheme
      let streamNum = (/(\d+)/g.exec($(elem).attr('id') ?? "") ?? [])[0]
      let groupName = $(`.ml-1.stream-text-${streamNum}`, elem).text()

      let volNum = 1
      let chapNum = 1
      let volumes = $('.volume', elem).toArray().reverse()
      for (let vol of volumes) {
        let chapterElem = $('li', vol).toArray().reverse()
        for (let chap of chapterElem) {
          let chapId = $(chap).attr('id')?.replace('b-', 'i')
          let name: string | undefined
          let nameArr = ($('a', chap).html() ?? "").replace(/(\t*\n*)/g, '').split(':')
          name = nameArr.length > 1 ? nameArr[1].trim() : undefined

          let time = this.convertTime($('.time', chap).text().trim())
          chapters.push(createChapter({
            id: chapId ?? '',
            mangaId: metadata.id,
            name: name,
            chapNum: chapNum,
            volume: volNum,
            time: time,
            group: groupName,
            langCode: 'en'
          }))
          chapNum++
        }
        volNum++
      }
    }

    return chapters
  }

  getChapterDetailsRequest(mangaId: string, chId: string): Request {
    let metadata = { 'mangaId': mangaId, 'chapterId': chId, 'nextPage': false, 'page': 1 }
    return createRequestObject({
      url: `${MP_DOMAIN}/manga/`,
      method: "GET",
      metadata: metadata,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        Cookie: 'set=h=1'
      },
      param: `${mangaId}/${chId}`
    })
  }


  getChapterDetails(data: any, metadata: any): { 'details': ChapterDetails, 'nextPage': boolean, 'param': string | null } {
    let script = JSON.parse((/var _load_pages = (.*);/.exec(data) ?? [])[1])
    let pages: string[] = []
    for (let page of script) {
      pages.push(page.u)
    }

    let chapterDetails = createChapterDetails({
      id: metadata.chapterId,
      mangaId: metadata.mangaId,
      pages: pages,
      longStrip: false
    })
    let returnObject = {
      'details': chapterDetails,
      'nextPage': metadata.nextPage,
      'param': null
    }
    return returnObject
  }


  filterUpdatedMangaRequest(ids: any, time: Date, page: number): any {
    let metadata = { 'ids': ids, 'referenceTime': time }
    return createRequestObject({
      url: `${MP_DOMAIN}/latest/`,
      method: 'GET',
      metadata: metadata,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        Cookie: 'set=h=1'
      },
      param: `${page}`
    })
  }

  filterUpdatedManga(data: any, metadata: any): { 'updatedMangaIds': string[], 'nextPage': boolean } {
    let $ = this.cheerio.load(data)

    let returnObject: { 'updatedMangaIds': string[], 'nextPage': boolean } = {
      'updatedMangaIds': [],
      'nextPage': true
    }

    for (let item of $('.item', '.ls1').toArray()) {
      let id = ($('a', item).first().attr('href') ?? '').split('/').pop() ?? ''
      let time = $('.time').first().text()
      if (this.convertTime(time) > metadata.referenceTime) {
        if (metadata.ids.includes(id)) {
          returnObject.updatedMangaIds.push(id)
        }
      }
      else {
        returnObject.nextPage = false
        return returnObject
      }
    }

    return returnObject
  }


  getHomePageSectionRequest(): HomeSectionRequest[] {
    let request = createRequestObject({ url: `${MP_DOMAIN}`, method: 'GET' })
    let section1 = createHomeSection({ id: 'popular_titles', title: 'POPULAR MANGA' })
    let section2 = createHomeSection({ id: 'popular_new_titles', title: 'POPULAR MANGA UPDATES' })
    let section3 = createHomeSection({ id: 'recently_updated', title: 'RECENTLY UPDATED TITLES' })

    return [createHomeSectionRequest({ request: request, sections: [section1, section2, section3] })]
  }

  getHomePageSections(data: any, sections: HomeSection[]): HomeSection[] {
    let $ = this.cheerio.load(data)
    let popManga: MangaTile[] = []
    let newManga: MangaTile[] = []
    let updateManga: MangaTile[] = []

    for (let item of $('li', '.top').toArray()) {
      let id: string = ($('.cover', item).attr('href') ?? '').split('/').pop() ?? ''
      let title: string = $('.cover', item).attr('title') ?? ''
      let image: string = $('img', item).attr('src') ?? ''
      let subtitle: string = $('.visited', item).text() ?? ''

      let sIcon = 'clock.fill'
      let sText = $('i', item).text()
      popManga.push(createMangaTile({
        id: id,
        image: image,
        title: createIconText({ text: title }),
        subtitleText: createIconText({ text: subtitle }),
        secondaryText: createIconText({ text: sText, icon: sIcon })
      }))
    }

    for (let item of $('ul', '.mainer').toArray()) {
      for (let elem of $('li', item).toArray()) {
        let id: string = ($('a', elem).first().attr('href') ?? '').split('/').pop() ?? ''
        let title: string = $('img', elem).attr('alt') ?? ''
        let image: string = $('img', elem).attr('src') ?? ''
        let subtitle: string = $('.visited', elem).text() ?? ''

        newManga.push(createMangaTile({
          id: id,
          image: image,
          title: createIconText({ text: title }),
          subtitleText: createIconText({ text: subtitle })
        }))
      }
    }

    for (let item of $('.item', 'article').toArray()) {
      let id: string = ($('.cover', item).attr('href') ?? '').split('/').pop() ?? ''
      let title: string = $('.cover', item).attr('title') ?? ''
      let image: string = $('img', item).attr('src') ?? ''
      let subtitle: string = $('.visited', item).text() ?? ''

      let sIcon = 'clock.fill'
      let sText = $('li.new', item).first().find('i').last().text() ?? ''
      updateManga.push(createMangaTile({
        id: id,
        image: image,
        title: createIconText({ text: title }),
        subtitleText: createIconText({ text: subtitle }),
        secondaryText: createIconText({ text: sText, icon: sIcon })
      }))
    }

    // console.log(updateManga)
    sections[0].items = popManga
    sections[1].items = newManga
    sections[2].items = updateManga
    return sections
  }

  getViewMoreRequest(key: string): Request {
    throw new Error("Method not implemented.")
  }

  getViewMoreItems(data: any, key: string, page: number): MangaTile[] {
    throw new Error("Method not implemented.")
  }


  searchRequest(query: SearchRequest, page: number): Request {
    let genres = ''
    for (let genre of (query.includeGenre ?? []).concat(query.includeDemographic ?? [])) {
      genres += genre + ','
    }
    let excluded = ''
    for (let genre of (query.excludeGenre ?? []).concat(query.excludeDemographic ?? [])) {
      excluded += genre + ','
    }
    let status = ""
    switch (query.status) {
      case 0: status = 'completed'; break
      case 1: status = 'ongoing'; break
      default: status = ''
    }
    let search: string = `q=${encodeURI(query.title ?? '')}&`
    search += `autart=${encodeURI(query.author || query.artist || '')}&`
    search += `&genres=${genres}&genres-exclude=${excluded}&page=${page}`
    search += `&status=${status}&st-ss=1`

    let metadata = { 'search': search }
    return createRequestObject({
      url: `${MP_DOMAIN}/search?`,
      method: 'GET',
      metadata: metadata,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        Cookie: `set=h=${query.hStatus ? 1 : 0}`
      },
      param: `${search}`
    })
  }

  search(data: any) {
    let $ = this.cheerio.load(data)
    let mangaList = $('.manga-list')
    let manga: MangaTile[] = []
    for (let item of $('.item', mangaList).toArray()) {
      let id = $('a', item).first().attr('href')?.split('/').pop() ?? ''
      let img = $('img', item)
      let image = $(img).attr('src') ?? ''
      let title = $(img).attr('title') ?? ''
      let rate = $('.rate', item)
      let rating = Number($(rate).find('i').text())
      let author = ""

      for (let field of $('.field', item).toArray()) {
        let elem = $('b', field).first().text()
        if (elem == 'Authors/Artists:') {
          let authorCheerio = $('a', field).first()
          author = $(authorCheerio).text()
        }
      }

      let lastUpdate = $('ul', item).find('i').text()

      manga.push(createMangaTile({
        id: id,
        image: image,
        title: createIconText({ text: title }),
        subtitleText: createIconText({ text: author }),
        primaryText: createIconText({ text: rating.toString(), icon: 'star.fill' }),
        secondaryText: createIconText({ text: lastUpdate, icon: 'clock.fill' })
      }))
    }

    return manga
  }
}