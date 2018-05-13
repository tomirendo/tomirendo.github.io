import React from 'react'
import Link from 'gatsby-link'
import './header.css'

const Header = ({ siteTitle }) => (
  <div
    style={{
      marginBottom: '1.45rem',
    }}
  >
    <div
      style={{
        margin: '0 auto',
        maxWidth: 960,
        padding: '1.45rem 1.0875rem',
      }}
    >
      <h1 style={{ margin: 0 }}>
        <Link
          to="/"
          style={{
            textDecoration: 'none',
          }}
          className='HeaderTitle'
        >
        כמה מחברות מעניינות
        </Link>
      </h1>
    </div>
  </div>
)

export default Header
