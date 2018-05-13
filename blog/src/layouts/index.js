import React from 'react'
import PropTypes from 'prop-types'
import Helmet from 'react-helmet'
import Media from 'react-media'

import Header from '../components/header'
import Sidebar from '../components/sidebar'
import './index.css'

const Layout = ({ children, data }) => (
  <div>
  <link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/3.3.7/css/bootstrap.min.css" integrity="sha384-BVYiiSIFeK1dGmJRAkycuHAHRg32OmUcww7on3RYdg4Va+PmSTsz/K68vbdEjh4u" crossorigin="anonymous" />

  <link href="https://fonts.googleapis.com/css?family=David+Libre" rel="stylesheet" />
  <link href="https://fonts.googleapis.com/css?family=Frank+Ruhl+Libre:400&amp;subset=hebrew" rel="stylesheet" />
  <link href="https://fonts.googleapis.com/css?family=Assistant:300&amp;subset=hebrew" rel="stylesheet" />

    <Helmet
      // title={data.site.siteMetadata.title}
      meta={[
        { name: 'description', content: 'Sample' },
        { name: 'keywords', content: 'sample, something' },
      ]}
    />
    <Header siteTitle='Title' />
    <div
      style={{
        margin: '0 auto',
        maxWidth: 960,
        padding: '0px 1.0875rem 1.45rem',
        paddingTop: 0,
      }}
    >
<Media query={{ maxWidth: 848 }}>
        {matches =>
          matches ? (
            <div
              style={{
                margin: "0 auto",
                maxWidth: 980,
                display: "flex",
                flexDirection: "row",
                justifyContent: "space-between",
                height: "100%",
                padding: "25px"
              }}
            >
              <div style={{ flex: 1 }}>{children()}</div>
            </div>
          ) : (
            <div
              style={{
                margin: "0 auto",
                maxWidth: 980,
                display: "flex",
                flexDirection: "row",
                justifyContent: "space-between",
                height: "100%",
                padding: "25px"
              }}
            >
            <div style={{ flex: 2.5, paddingLeft: "30px" }}>
               {children()}
             </div>
           <div style={{ flex: 1 }}>
                <Sidebar
                  title="אני יותם"
                  description="ויש לי כמה דברים לכתוב עליהם. אני גם סוג של פיסיקאי."
                >
                </Sidebar>
              </div>


            </div>
          )
        }
      </Media>    </div>
  </div>
)

Layout.propTypes = {
  children: PropTypes.func,
}

export default Layout

export const query = graphql`
  query SiteTitleQuery {
    site {
      siteMetadata {
        title
      }
    }
  }
`
