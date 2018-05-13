import React from 'react'
import Link from 'gatsby-link'
import './figure.css'

const Figure = (props) => (
  <div>
    <img src={props.image} className="figureImage" />
    <p className='figureText'>
    {props.children}
    </p>
  </div>
)

export default Figure
