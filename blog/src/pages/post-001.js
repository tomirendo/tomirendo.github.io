import React from 'react'
import Link from 'gatsby-link'
import { Table } from 'react-bootstrap';
import Figure from '../components/figure'

import './post.css'

const data = [[1,2],[3,4],[5,6]];

const Post = () => (
  <div>
  <h1>ווידויים </h1>
  <p>
    בשנה האחרונה נעשינו סקרנים מאוד לגבי האופן שבו מתנהלים אתרי היכרויות.

    עשינו כמה מחקרים משעשעים ב-Tinder, באחד מהם איתמר ניצח עם פרופיל פקטיבי שכל התיאור שלו היה ׳נא לא לשבור לי את הלב׳.
    בעבר הלא רחוק,&nbsp;
    <a href='https://web.archive.org/web/20140122002808/http://blog.okcupid.com/' target='_blank'>הבלוג של אתר ההיכרויות OkCupid</a>

&nbsp;היה מקור לסטטיסטיקות משעשעות מאוד ממאגר המידע הייחודי שלהם.   מאז צצו מעט מתחרים, כמו&nbsp;
<a href ="https://medium.com/@worstonlinedater/tinder-experiments-ii-guys-unless-you-are-really-hot-you-are-probably-better-off-not-wasting-your-2ddf370a6e9a">
מחקר מפוקפק שניסה לחשב את מדד ג׳יני של טינדר
</a>
. בו  ה׳חוקר׳ העמיד פנים שהוא גבר חתיך, וראיין את הנשים שאותן פגש בפלטפורמה.
  </p>

  <p>
    אבל בזכות רעיון מבריק של איתמר, הצלחנו סוף כל סוף להשיג מאגר נתונים מכובד מאתר היכרויות פופולארי.
  יותר מ-1000 פרופילים ישראלים של נשים וגברים, מדורגים לפי כמה הם מושכים.
  </p>


<p>

למי שלא זכה להכיר, בשנה האחרונה צצו מספר קבוצות פו״פ בפיסבוק שנקראות ״וידויים לצורכי היכרויות״. בקבוצות האלו הרווקות והרווקים מפרסים מי הם באופן אנונימי (בד״כ בטופס חיצוני), לדוגמה: ״אני סטודנט בן 22 מאוניברסיטת בן גוריון, בלונדיני ואוהב מרק כתום״. נשים שרוצות להכיר את הסטודנט שלנו (או גברים שרוצים להכיר סטודנטית) עושים לייק להודעה. לאחר מכן מצופה מהמפרסם או מהמפרסמת לפנות למי שעשה להם לייק באמצעות הצ׳ט של פייסבוק.
</p>

<h3>
כמה תובנות ראשוניות
</h3>
<p>
הורדנו את כל הנתונים של הקבוצה
<a href="https://www.facebook.com/%D7%95%D7%99%D7%93%D7%95%D7%99%D7%99%D7%9D-%D7%9C%D7%9E%D7%98%D7%A8%D7%95%D7%AA-%D7%94%D7%99%D7%9B%D7%A8%D7%95%D7%AA-22-990693251093160/"> וידויים למטרות היכרות 22+ </a>. הקבוצה נועדה לרווקות ורווקים בני 22 ומעלה. בקבוצה יש, נכון לעכשיו, 630 פרסומים של גברים, ו-325 פרסומים של נשים. הגבר הממוצע מקבל 24 לייקים, והאישה הממוצעת מקבלת 42. הגיל הממוצע של הגברים הוא 24.5, והגיל הממוצע של הנשים הוא 22.8. עבור גברים, הגרף של מספר הלייקים הממוצע לפי הגיל הוא:
</p>

<Figure image={require("./post_001/figure_01.png")}>
מספר לייקים ממוצע כפונקציה של הגיל (גברים). הערכים הם ממוצעים על פני 650 פרופילים. הגרף הכחול הוא קירוב לגאוסיאן.
</Figure>

<p>
ניתן לראות שגברים מתחת לגיל 22 כמעט ולא מקבלים תשומת לב, והגיל האופטימלי לגבר הוא 27. הפיק יחסית חד, ולא שזה מעניין אבל סטית התקן היא 2.8. עבור נשים, המצב עגום בהרבה:
</p>

<Figure image={require("./post_001/figure_02.png")}>
מספר לייקים ממוצע כפונקציה של הגיל (נשים). הערכים הם ממוצעים על פני 360 פרופילים. מתברר שגברים אוהבים נשים צעירות, ולא צריך הרבה דמיון כדי לראות שהם מעבירים קו ישר, שחוצה את ה-0 בערך בגיל 31.
</Figure>

<p>
המסר לנשים הוא רוצו להתחתן ומהר, כי גברים הם מפלצות.
</p>

<h3>
אז מה לכתוב?
</h3>

<div className='scrollableTable'>
<Table>
<tr>
  <td>
      מילה
  </td>
  <td>
לייקים (בממוצע)
</td>
</tr>
  {data.map((x) =>
    ( <tr>
      {x.map((y) => (<td> {y} </td>))}
      </tr>

    )
  )}
  </Table>
</div>

    <Link to="/page-2/">Go to page 2</Link>
  </div>
)

export default Post
